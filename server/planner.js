// Pickup planner: decides where each rider should get off public transit and
// in what order the driver collects them, so the whole group is together
// (and at the destination) as early as possible.
//
// Pipeline
//   1. For each rider, fetch transit itineraries toward the driver and toward
//      the destination. Every stop along those rides where alighting is allowed
//      becomes a candidate pickup point with a known arrival time. The rider's
//      own location is always a candidate too ("driver comes to you").
//   2. Prune to the most promising, geographically spread candidates.
//   3. One OSRM duration matrix between driver, destination and all candidates.
//   4. For every rider order, dynamic programming over candidates with
//      Pareto labels (time, driving) finds the plan minimising
//      finalArrival + lambda * drivingTime.
//   5. Build human instructions; re-plan riders who would wait long so they
//      can leave home later.

const MAX_RIDERS = 6;
const MAX_MATRIX_POINTS = 100;
const PICKUP_BUFFER_S = 120; // time to pull over and get in
const LONG_WAIT_S = 8 * 60; // re-plan rider if they'd wait longer than this
const LABELS_PER_NODE = 8;

const PRIORITY_WEIGHTS = {
  fastest: 0.1, // 10 min of driving is worth 1 min of group time
  balanced: 0.35,
  lessDriving: 1.0,
};

// ---------- geometry helpers ----------

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough driving-seconds estimate used only for pruning. */
function estimateDrive(a, b) {
  return (haversine(a, b) * 1.35) / 16; // road detour factor, ~58 km/h average
}

function decodePolyline(str, precision = 7) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

/** Cut a polyline at the vertex nearest to `point`. */
function truncateLine(coords, point) {
  let best = coords.length - 1;
  let bestD = Infinity;
  coords.forEach(([lat, lon], i) => {
    const d = haversine({ lat, lon }, point);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return coords.slice(0, best + 1);
}

const isTransitLeg = (leg) => Boolean(leg.tripId || leg.routeShortName);
const t = (iso) => Date.parse(iso);

// ---------- step 1: candidates ----------

function extractCandidates(rider, itineraries, departAfterMs) {
  const home = {
    key: `home:${rider.id}`,
    kind: 'home',
    name: rider.place.label || 'Home',
    lat: rider.place.lat,
    lon: rider.place.lon,
    arrival: departAfterMs,
  };
  const byStop = new Map();
  for (const it of itineraries) {
    it.legs.forEach((leg, legIndex) => {
      if (!isTransitLeg(leg)) return;
      const stops = (leg.intermediateStops || []).map((s, stopIndex) => ({ s, stopIndex }));
      stops.push({ s: leg.to, stopIndex: -1 }); // -1 = the leg's own alighting stop
      for (const { s, stopIndex } of stops) {
        if (s.dropoffType === 'NOT_ALLOWED' || s.cancelled) continue;
        const arrival = t(s.arrival || s.scheduledArrival);
        if (!Number.isFinite(arrival)) continue;
        const key = s.stopId || `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
        const prev = byStop.get(key);
        if (prev && prev.arrival <= arrival) continue;
        byStop.set(key, {
          key,
          kind: 'stop',
          name: s.name,
          stopCode: s.stopCode || null,
          lat: s.lat,
          lon: s.lon,
          arrival,
          itinerary: it,
          legIndex,
          stopIndex,
        });
      }
    });
  }
  return [home, ...byStop.values()];
}

// ---------- step 2: pruning ----------

function pruneCandidates(cands, { driverOrigin, destination, departAfterMs, limit }) {
  const score = (c) => {
    const meet = Math.max(c.arrival, departAfterMs + estimateDrive(driverOrigin, c) * 1000);
    const onward = destination ? estimateDrive(c, destination) * 1000 : 0;
    return meet + onward;
  };
  const home = cands.find((c) => c.kind === 'home');
  const rest = cands.filter((c) => c !== home).sort((a, b) => score(a) - score(b));
  const kept = [home];
  // Greedy in score order, skipping stops within 300 m of one already kept,
  // so we offer genuinely different places rather than 10 stops on one street.
  for (const c of rest) {
    if (kept.length >= limit) break;
    if (kept.some((k) => haversine(k, c) < 300)) continue;
    kept.push(c);
  }
  return kept;
}

// ---------- step 4: optimisation ----------

function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr.slice();
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

function paretoPrune(labels, lambda) {
  labels.sort((a, b) => a.time - b.time || a.drive - b.drive);
  const out = [];
  let bestDrive = Infinity;
  for (const l of labels) {
    if (l.drive < bestDrive - 1e-6) {
      out.push(l);
      bestDrive = l.drive;
    }
  }
  if (out.length > LABELS_PER_NODE) {
    out.sort((a, b) => a.time + lambda * a.drive - (b.time + lambda * b.drive));
    out.length = LABELS_PER_NODE;
  }
  return out;
}

/**
 * Pure optimiser.
 * @param {object} p
 * @param {Array<{cands: Array<{idx:number, arrival:number}>}>} p.riders
 * @param {number[][]} p.matrix  seconds between point indices (null = unreachable)
 * @param {number} p.startIdx    driver origin index
 * @param {number|null} p.destIdx destination index (null = trip ends at last pickup)
 * @param {number} p.t0          earliest driver departure (ms)
 * @param {number} p.lambda      weight of driving seconds vs arrival seconds
 * @param {number} [p.traffic]   multiplier applied to matrix durations
 * @param {number} [p.bufferS]   stop time per pickup
 * @returns sorted list of solutions {score, finalTime, drive, picks:[{rider, cand, driverArrive, pickupAt}]}
 */
function optimize({ riders, matrix, startIdx, destIdx, t0, lambda, traffic = 1, bufferS = PICKUP_BUFFER_S }) {
  const dur = (i, j) => (i === j ? 0 : matrix[i][j] == null ? null : matrix[i][j] * traffic * 1000);
  const buffer = bufferS * 1000;
  const solutions = [];
  const order0 = riders.map((_, i) => i);

  for (const order of permutations(order0)) {
    let labels = [{ time: t0, drive: 0, at: startIdx, parent: null, pick: null }];
    for (const r of order) {
      const next = [];
      for (const cand of riders[r].cands) {
        const here = [];
        for (const L of labels) {
          const d = dur(L.at, cand.idx);
          if (d == null) continue;
          const driverArrive = L.time + d;
          const sameSpot = L.at === cand.idx && L.parent !== null;
          // at the same spot the driver is already parked: only a late rider adds boarding time
          const pickupAt = sameSpot
            ? Math.max(L.time, cand.arrival + buffer)
            : Math.max(driverArrive, cand.arrival) + buffer;
          here.push({
            time: pickupAt,
            drive: L.drive + d,
            at: cand.idx,
            parent: L,
            pick: { rider: r, cand, driverArrive, pickupAt },
          });
        }
        next.push(...paretoPrune(here, lambda));
      }
      labels = next;
      if (!labels.length) break;
    }
    for (const L of labels) {
      if (!L.pick) continue;
      let finalTime = L.time;
      let drive = L.drive;
      if (destIdx != null) {
        const d = dur(L.at, destIdx);
        if (d == null) continue;
        finalTime += d;
        drive += d;
      }
      const picks = [];
      for (let x = L; x.pick; x = x.parent) picks.unshift(x.pick);
      if (picks.length !== riders.length) continue;
      solutions.push({ score: finalTime + lambda * drive, finalTime, drive, picks });
    }
  }
  solutions.sort((a, b) => a.score - b.score);
  return solutions;
}

// ---------- step 5: instructions ----------

function modeLabel(mode) {
  return (
    {
      BUS: 'Bus',
      COACH: 'Bus',
      TRAM: 'Light rail',
      SUBWAY: 'Metro',
      RAIL: 'Train',
      REGIONAL_RAIL: 'Train',
      REGIONAL_FAST_RAIL: 'Train',
      HIGHSPEED_RAIL: 'Train',
      LONG_DISTANCE: 'Train',
      NIGHT_RAIL: 'Train',
      SUBURBAN: 'Train',
      FERRY: 'Ferry',
      CABLE_CAR: 'Cable car',
      FUNICULAR: 'Funicular',
    }[mode] || 'Transit'
  );
}

/** Turn a (possibly truncated) itinerary into rider steps + map geometry. */
function itinerarySteps(it, { legIndex = it.legs.length - 1, stopIndex = -1, pickupName, homeLabel }) {
  const legs = it.legs.slice(0, legIndex + 1);
  const steps = [];
  const geometry = [];
  legs.forEach((leg, i) => {
    const isLast = i === legs.length - 1;
    let to = leg.to;
    let stopsCount = (leg.intermediateStops || []).length + 1;
    let coords = leg.legGeometry ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision || 7) : [];
    if (isLast && stopIndex >= 0) {
      to = leg.intermediateStops[stopIndex];
      stopsCount = stopIndex + 1;
      coords = truncateLine(coords, to);
    }
    const fromName = leg.from.name === 'START' ? homeLabel || 'your location' : leg.from.name;
    const toName = to.name === 'END' ? pickupName : to.name;
    const departAt = leg.startTime;
    const arriveAt = to.arrival || leg.endTime;
    if (isTransitLeg(leg)) {
      steps.push({
        type: 'ride',
        mode: leg.mode,
        modeLabel: modeLabel(leg.mode),
        line: leg.routeShortName && leg.routeShortName.length <= 8 ? leg.routeShortName : leg.tripShortName || '',
        routeName: leg.routeShortName || leg.displayName || '',
        headsign: leg.headsign || '',
        agency: leg.agencyName || '',
        from: fromName,
        fromCode: leg.from.stopCode || null,
        to: toName,
        toCode: to.stopCode || null,
        departAt,
        arriveAt,
        stops: stopsCount,
      });
    } else if (leg.duration >= 60 || (leg.distance || 0) > 50) {
      steps.push({
        type: 'walk',
        from: fromName,
        to: toName,
        minutes: Math.max(1, Math.round(leg.duration / 60)),
        meters: Math.round(leg.distance || 0),
        departAt,
        arriveAt,
      });
    }
    if (coords.length) geometry.push({ mode: isTransitLeg(leg) ? 'transit' : 'walk', coords });
  });
  return { steps, geometry, leaveAt: legs[0].startTime, arriveAt: steps.at(-1)?.arriveAt || legs.at(-1).endTime };
}

const wazeUrl = (p) => `https://waze.com/ul?ll=${p.lat.toFixed(6)},${p.lon.toFixed(6)}&navigate=yes`;
const gmapsTransitUrl = (from, to) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&travelmode=transit`;
const gmapsDriveUrl = (origin, stops, dest) => {
  const all = [...stops, ...(dest ? [dest] : [])];
  const last = all.pop();
  const qs = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lon}`,
    destination: `${last.lat},${last.lon}`,
    travelmode: 'driving',
  });
  if (all.length) qs.set('waypoints', all.map((p) => `${p.lat},${p.lon}`).join('|'));
  return `https://www.google.com/maps/dir/?${qs}`;
};

const iso = (ms) => new Date(ms).toISOString();

// ---------- orchestration ----------

/**
 * @param {object} input
 * @param {{id,name,place:{lat,lon,label}}} input.driver
 * @param {Array<{id,name,place:{lat,lon,label}}>} input.riders
 * @param {{type:'driverStart'|'custom'|'none', place?:{lat,lon,label}}} input.destination
 * @param {string|Date} [input.departAfter]
 * @param {'fastest'|'balanced'|'lessDriving'} [input.priority]
 * @param {number} [input.trafficFactor]
 * @param {object} providers - see providers.js
 */
async function planTrip(input, providers) {
  const { driver, riders } = input;
  if (!driver?.place) throw new Error('The driver has not set a location yet.');
  if (!riders.length) throw new Error('Add at least one rider.');
  const missing = riders.filter((r) => !r.place).map((r) => r.name);
  if (missing.length) throw new Error(`Waiting for location from: ${missing.join(', ')}`);
  if (riders.length > MAX_RIDERS) throw new Error(`At most ${MAX_RIDERS} riders per trip.`);

  const t0 = Math.max(Date.now(), input.departAfter ? Date.parse(input.departAfter) : 0);
  const lambda = PRIORITY_WEIGHTS[input.priority] ?? PRIORITY_WEIGHTS.balanced;
  const traffic = input.trafficFactor || 1.2;
  const notes = [];

  const dest =
    input.destination?.type === 'custom' && input.destination.place
      ? { ...input.destination.place }
      : input.destination?.type === 'none'
        ? null
        : { ...driver.place, label: driver.place.label || 'Back to start' };

  // 1. transit itineraries per rider (toward driver + toward destination)
  const targets = [driver.place];
  if (dest && haversine(dest, driver.place) > 2000) targets.push(dest);
  const itinsPerRider = await Promise.all(
    riders.map(async (r) => {
      const results = await Promise.all(
        targets.map((to) =>
          providers.transitPlan(r.place, to, { time: new Date(t0), count: 5 }).catch((e) => {
            notes.push(`Transit lookup failed for ${r.name}: ${e.message}`);
            return [];
          }),
        ),
      );
      return results.flat();
    }),
  );

  // 2. candidates
  const perRiderLimit = Math.max(4, Math.min(24, Math.floor((MAX_MATRIX_POINTS - 2) / riders.length)));
  const riderCands = riders.map((r, i) => {
    const all = extractCandidates(r, itinsPerRider[i], t0);
    if (all.length === 1) notes.push(`No public transit found for ${r.name} at this time — the driver will pick them up at their location.`);
    return pruneCandidates(all, { driverOrigin: driver.place, destination: dest, departAfterMs: t0, limit: perRiderLimit });
  });

  // 3. point list (shared stops across riders get one index) + matrix
  const points = [driver.place];
  const indexByKey = new Map([['driver', 0]]);
  let destIdx = null;
  if (dest) {
    if (dest.lat === driver.place.lat && dest.lon === driver.place.lon) destIdx = 0;
    else {
      destIdx = points.length;
      points.push(dest);
    }
  }
  for (const cands of riderCands) {
    for (const c of cands) {
      if (!indexByKey.has(c.key)) {
        indexByKey.set(c.key, points.length);
        points.push(c);
      }
      c.idx = indexByKey.get(c.key);
    }
  }
  const matrix = await providers.driveMatrix(points);

  // 4. optimise
  const solutions = optimize({
    riders: riderCands.map((cands) => ({ cands })),
    matrix,
    startIdx: 0,
    destIdx,
    t0,
    lambda,
    traffic,
  });
  if (!solutions.length) throw new Error('Could not find a drivable plan — check that everyone is in a reachable place.');
  const best = solutions[0];

  // 5. driver timeline
  const dur = (i, j) => (i === j ? 0 : matrix[i][j] * traffic * 1000);
  const buffer = PICKUP_BUFFER_S * 1000;

  // group consecutive picks at the same spot into one stop
  const stops = [];
  for (const p of best.picks) {
    const last = stops.at(-1);
    if (last && last.idx === p.cand.idx) {
      last.riders.push(p);
      last.pickupAt = Math.max(last.pickupAt, p.pickupAt);
    } else stops.push({ idx: p.cand.idx, cand: p.cand, riders: [p], pickupAt: p.pickupAt });
  }
  // "ready" = when the driver needs to be there; pickup finishes one buffer later.
  // Leave so we reach the first stop exactly when it is ready, not earlier.
  for (const s of stops) s.readyAt = s.pickupAt - buffer;
  const leaveAt = Math.max(t0, stops[0].readyAt - dur(0, stops[0].idx));
  let clock = leaveAt;
  let at = 0;
  for (const s of stops) {
    s.driverEta = clock + dur(at, s.idx);
    clock = s.pickupAt;
    at = s.idx;
  }
  const destEta = destIdx != null ? clock + dur(at, destIdx) : null;

  let route = null;
  try {
    const routePts = [driver.place, ...stops.map((s) => s.cand), ...(dest ? [dest] : [])];
    route = await providers.driveRoute(routePts);
  } catch (e) {
    notes.push(`Could not draw the driving route: ${e.message}`);
  }

  // rider instructions (re-plan long waits so riders can leave later)
  const riderOut = await Promise.all(
    best.picks.map(async (p) => {
      const rider = riders[p.rider];
      const c = p.cand;
      const stop = stops.find((s) => s.riders.includes(p));
      const pickupAt = stop.pickupAt;
      const meetAt = Math.max(stop.driverEta, stop.readyAt); // rider should be there by this time
      const base = {
        participantId: rider.id,
        name: rider.name,
        origin: rider.place,
        pickup: {
          name: c.kind === 'home' ? rider.place.label || 'Your location' : c.name,
          stopCode: c.stopCode || null,
          lat: c.lat,
          lon: c.lon,
          kind: c.kind,
          driverEta: iso(stop.driverEta),
          meetAt: iso(meetAt),
          pickupAt: iso(pickupAt),
        },
      };
      if (c.kind === 'home') {
        return {
          ...base,
          mode: 'home',
          leaveAt: null,
          arriveAt: null,
          waitMinutes: 0,
          steps: [{ type: 'home', text: 'Stay where you are — the driver comes to you.' }],
          geometry: [],
          mapsUrl: null,
        };
      }
      let plan = itinerarySteps(c.itinerary, {
        legIndex: c.legIndex,
        stopIndex: c.stopIndex,
        pickupName: c.name,
        homeLabel: rider.place.label,
      });
      if (meetAt - c.arrival > LONG_WAIT_S) {
        try {
          const later = await providers.transitPlan(rider.place, c, {
            time: new Date(meetAt),
            arriveBy: true,
            count: 3,
          });
          const fits = later
            .filter((it) => t(it.endTime) <= meetAt && it.legs.some(isTransitLeg))
            .sort((a, b) => t(b.startTime) - t(a.startTime))[0];
          if (fits && t(fits.startTime) > t(plan.leaveAt)) {
            plan = itinerarySteps(fits, { pickupName: c.name, homeLabel: rider.place.label });
          }
        } catch {
          /* keep the original plan */
        }
      }
      const arrive = t(plan.arriveAt);
      return {
        ...base,
        mode: 'transit',
        leaveAt: plan.leaveAt,
        arriveAt: plan.arriveAt,
        waitMinutes: Math.max(0, Math.round((meetAt - arrive) / 60000)),
        steps: plan.steps,
        geometry: plan.geometry,
        mapsUrl: gmapsTransitUrl(rider.place, c),
      };
    }),
  );

  // alternatives: next-best distinct pickup plans
  const seen = new Set();
  const alternatives = [];
  for (const s of solutions) {
    const sig = s.picks.map((p) => p.cand.key).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    alternatives.push({
      finalTime: iso(s.finalTime),
      driveMinutes: Math.round(s.drive / 60000),
      extraMinutes: Math.round((s.finalTime - best.finalTime) / 60000),
      pickups: s.picks.map((p) => ({
        rider: riders[p.rider].name,
        place: p.cand.kind === 'home' ? `${riders[p.rider].name}'s location` : p.cand.name,
      })),
    });
    if (alternatives.length >= 4) break;
  }
  alternatives.shift(); // first one is the chosen plan

  const stopsOut = stops.map((s) => ({
    name: s.cand.kind === 'home' ? `${riders[s.riders[0].rider].name}'s location` : s.cand.name,
    stopCode: s.cand.stopCode || null,
    lat: s.cand.lat,
    lon: s.cand.lon,
    riders: s.riders.map((p) => riders[p.rider].name),
    eta: iso(s.driverEta),
    pickupAt: iso(s.pickupAt),
    wazeUrl: wazeUrl(s.cand),
  }));

  return {
    computedAt: new Date().toISOString(),
    departAfter: iso(t0),
    priority: input.priority || 'balanced',
    summary: {
      driverLeaveAt: iso(leaveAt),
      lastPickupAt: iso(stops.at(-1).pickupAt),
      finalArrival: destEta ? iso(destEta) : iso(stops.at(-1).pickupAt),
      driveMinutes: Math.round(best.drive / 60000),
    },
    driver: {
      participantId: driver.id,
      name: driver.name,
      origin: driver.place,
      leaveAt: iso(leaveAt),
      stops: stopsOut,
      destination: dest ? { ...dest, eta: iso(destEta), wazeUrl: wazeUrl(dest) } : null,
      googleMapsUrl: gmapsDriveUrl(driver.place, stopsOut, dest),
      route: route
        ? { coordinates: route.coordinates, km: +(route.distance / 1000).toFixed(1) }
        : null,
    },
    riders: riderOut,
    alternatives,
    notes,
  };
}

module.exports = {
  planTrip,
  optimize,
  extractCandidates,
  pruneCandidates,
  itinerarySteps,
  decodePolyline,
  haversine,
  PRIORITY_WEIGHTS,
  MAX_RIDERS,
};
