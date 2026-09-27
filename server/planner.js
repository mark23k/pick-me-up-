// Pickup planner: decides where each rider should get off public transit,
// which car collects them and in what order, so the whole group reaches the
// destination (via any stops on the way) as early as possible.
//
// Pipeline
//   1. For each rider, fetch transit itineraries toward the driver and toward
//      the destination. Every stop along those rides where alighting is allowed
//      becomes a candidate pickup point with a known arrival time. The rider's
//      own location is always a candidate too ("driver comes to you").
//   2. Prune to the most promising, geographically spread candidates.
//   3. One OSRM duration matrix between driver, destination and all candidates.
//   4. For every driver and every group of riders that fits in their car, try
//      every rider order with dynamic programming over candidates (Pareto
//      labels of time vs driving). Each car's route is: pickups, then the
//      trip's stops in order, then the destination, so pickups lean toward
//      where the group is heading. Then choose the split of riders between
//      cars minimising  average rider arrival + lambda * extra driving
//      + a moderate cost for each rider minute spent on transit.
//   5. Build human instructions; re-plan riders who would wait long so they
//      can leave home later.

const MAX_RIDERS = 6;
const MAX_DRIVERS = 4;
const MAX_STOPS = 3; // stops on the way, visited after all pickups
const DEFAULT_SEATS = 4;
const MAX_SEATS = 6;
const MAX_MATRIX_POINTS = 100;
const PICKUP_BUFFER_S = 120; // time to pull over and get in
const LONG_WAIT_S = 8 * 60; // re-plan rider if they'd wait longer than this
const LABELS_PER_NODE = 8;
// Cost of a rider's minute on buses/trains before pickup, relative to a minute of arrival
// time. Low enough that meeting at a stop still wins when it saves real driving, high
// enough that nobody rides two hours to reach a car that could have come to them.
const RIDER_TRANSIT_WEIGHT = 0.25;

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
          depart: t(it.startTime),
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

function pruneCandidates(cands, { driverOrigins, destination, departAfterMs, limit }) {
  const score = (c) => {
    const reach = Math.min(...driverOrigins.map((o) => estimateDrive(o, c)));
    const meet = Math.max(c.arrival, departAfterMs + reach * 1000);
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

/** Keep labels not beaten on both time and cost (lambda * driving + rider transit penalty). */
function paretoPrune(labels, lambda) {
  const cost = (l) => lambda * l.drive + l.pen;
  labels.sort((a, b) => a.time - b.time || cost(a) - cost(b));
  const out = [];
  let best = Infinity;
  for (const l of labels) {
    if (cost(l) < best - 1e-6) {
      out.push(l);
      best = cost(l);
    }
  }
  if (out.length > LABELS_PER_NODE) {
    out.sort((a, b) => a.time + cost(a) - (b.time + cost(b)));
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
 * @param {number} [p.mu]        weight of rider minutes on transit (cand.arrival - cand.depart)
 * @returns sorted list of solutions {score, finalTime, drive, pen, picks:[{rider, cand, driverArrive, pickupAt}]}
 */
function optimize({ riders, matrix, startIdx, destIdx, t0, lambda, traffic = 1, bufferS = PICKUP_BUFFER_S, mu = 0 }) {
  const dur = (i, j) => (i === j ? 0 : matrix[i][j] == null ? null : matrix[i][j] * traffic * 1000);
  const buffer = bufferS * 1000;
  const solutions = [];
  const order0 = riders.map((_, i) => i);

  for (const order of permutations(order0)) {
    let labels = [{ time: t0, drive: 0, pen: 0, at: startIdx, parent: null, pick: null }];
    for (const r of order) {
      const next = [];
      for (const cand of riders[r].cands) {
        const here = [];
        const pen = cand.depart != null ? mu * Math.max(0, cand.arrival - cand.depart) : 0;
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
            pen: L.pen + pen,
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
      solutions.push({ score: finalTime + lambda * drive + L.pen, finalTime, drive, pen: L.pen, picks });
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

const seatsOf = (d) => Math.min(MAX_SEATS, Math.max(1, Math.round(Number(d.seats) || DEFAULT_SEATS)));
const sameSpot = (a, b) => a && b && haversine(a, b) < 50;

/** Every way to give each rider a car without going over its seats: arrays of driver indices. */
function* assignments(nRiders, seats) {
  const load = seats.map(() => 0);
  const pick = [];
  function* go(r) {
    if (r === nRiders) {
      yield pick.slice();
      return;
    }
    for (let d = 0; d < seats.length; d++) {
      if (load[d] >= seats[d]) continue;
      load[d]++;
      pick.push(d);
      yield* go(r + 1);
      pick.pop();
      load[d]--;
    }
  }
  yield* go(0);
}

/**
 * @param {object} input
 * @param {Array<{id,name,seats?,place:{lat,lon,label}}>} input.drivers  (or a single input.driver)
 * @param {Array<{id,name,place:{lat,lon,label}}>} input.riders
 * @param {{type:'driverStart'|'custom'|'none', place?:{lat,lon,label}}} input.destination
 * @param {Array<{lat,lon,label}>} [input.stops]  stops on the way, after the pickups
 * @param {string|Date} [input.departAfter]
 * @param {'fastest'|'balanced'|'lessDriving'} [input.priority]
 * @param {number} [input.trafficFactor]
 * @param {object} providers - see providers.js
 */
async function planTrip(input, providers) {
  const drivers = input.drivers || (input.driver ? [input.driver] : []);
  const { riders } = input;
  if (!drivers.length) throw new Error('Someone needs to join as a driver.');
  if (!riders.length) throw new Error('Add at least one rider.');
  const missing = [...drivers, ...riders].filter((p) => !p.place).map((p) => p.name);
  if (missing.length) throw new Error(`Waiting for location from: ${missing.join(', ')}`);
  if (riders.length > MAX_RIDERS) throw new Error(`At most ${MAX_RIDERS} riders per trip.`);
  if (drivers.length > MAX_DRIVERS) throw new Error(`At most ${MAX_DRIVERS} drivers per trip.`);
  const seats = drivers.map(seatsOf);
  const totalSeats = seats.reduce((a, b) => a + b, 0);
  if (totalSeats < riders.length) {
    throw new Error(
      `Not enough seats: ${riders.length} people need a ride but the car${drivers.length > 1 ? 's have' : ' has'} ${totalSeats} free seat${totalSeats === 1 ? '' : 's'}. Drivers can change their seats under Your location.`,
    );
  }

  const t0 = Math.max(Date.now(), input.departAfter ? Date.parse(input.departAfter) : 0);
  const lambda = PRIORITY_WEIGHTS[input.priority] ?? PRIORITY_WEIGHTS.balanced;
  const traffic = input.trafficFactor || 1.2;
  const notes = [];

  // Where every car goes after its pickups: the stops in order, then the destination.
  const tripStops = (input.stops || []).slice(0, MAX_STOPS).map((s) => ({ ...s, label: s.label || 'Stop' }));
  const destType = input.destination?.type === 'custom' && input.destination.place ? 'custom' : input.destination?.type || 'driverStart';
  const sharedDest = destType === 'custom' ? { ...input.destination.place } : null;
  // "driverStart" (older trips): each car goes back to its own start.
  const finalFor = (d) => (destType === 'custom' ? sharedDest : destType === 'none' ? null : { ...d.place, label: d.place.label || 'Back to start' });
  const heading = tripStops[0] || sharedDest; // where the group heads after pickups

  // 1. transit itineraries per rider: toward the nearest drivers and toward where the group is heading
  const slowFor = new Set(); // riders whose timetable lookups failed or timed out
  const itinsPerRider = await Promise.all(
    riders.map(async (r) => {
      const targets = [...drivers]
        .sort((a, b) => haversine(r.place, a.place) - haversine(r.place, b.place))
        .slice(0, 2)
        .map((d) => d.place);
      if (heading) targets.push(heading);
      else if (destType === 'driverStart') targets.push(drivers[0].place);
      const distinct = targets.filter((p, i) => !targets.slice(0, i).some((q) => haversine(p, q) < 2000));
      const results = await Promise.all(
        distinct.map((to) =>
          providers.transitPlan(r.place, to, { time: new Date(t0), count: 5 }).catch(() => {
            slowFor.add(r.name);
            return [];
          }),
        ),
      );
      return results.flat();
    }),
  );

  // 2. point list: drivers, stops, destination, then candidates (shared stops get one index)
  const points = drivers.map((d) => d.place);
  const pointIdx = (p) => {
    const found = points.findIndex((q) => sameSpot(q, p));
    if (found >= 0) return found;
    points.push(p);
    return points.length - 1;
  };
  const chains = drivers.map((d, di) => {
    const fin = finalFor(d);
    const chain = [...tripStops, ...(fin ? [fin] : [])];
    return chain.map((p) => (fin === p && destType === 'driverStart' ? di : pointIdx(p)));
  });

  const fixed = points.length;
  const perRiderLimit = Math.max(4, Math.min(24, Math.floor((MAX_MATRIX_POINTS - fixed) / riders.length)));
  const riderCands = riders.map((r, i) => {
    const all = extractCandidates(r, itinsPerRider[i], t0);
    if (all.length === 1 && !slowFor.has(r.name)) {
      notes.push(`No public transit found for ${r.name} at this time, so a driver will pick them up at their location.`);
    }
    return pruneCandidates(all, {
      driverOrigins: drivers.map((d) => d.place),
      destination: heading,
      departAfterMs: t0,
      limit: perRiderLimit,
    });
  });
  if (slowFor.size) {
    const names = [...slowFor];
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    notes.push(`Bus times for ${list} were slow to load, so some bus options may be missing. Tap Recalculate to try again.`);
  }
  const indexByKey = new Map();
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
  const dur = (i, j) => (i === j ? 0 : matrix[i][j] == null ? null : matrix[i][j] * traffic * 1000);

  // time and driving after the last pickup: first chain point onward
  const tails = chains.map((chain) => {
    let s = 0;
    for (let i = 1; i < chain.length; i++) s += dur(chain[i - 1], chain[i]) ?? Infinity;
    return s;
  });
  const direct = drivers.map((_, di) => (chains[di].length ? (dur(di, chains[di][0]) ?? Infinity) + tails[di] : 0));

  // 3. best routes for every (driver, group of riders)
  const memo = new Map();
  const solve = (di, members) => {
    const key = `${di}:${members.join(',')}`;
    if (memo.has(key)) return memo.get(key);
    let sols;
    if (!members.length) {
      sols = [{ picks: [], end: t0 + direct[di], drive: direct[di], pen: 0, extra: 0 }];
    } else {
      sols = optimize({
        riders: members.map((r) => ({ cands: riderCands[r] })),
        matrix,
        startIdx: di,
        destIdx: chains[di][0] ?? null,
        t0,
        lambda,
        traffic,
        mu: RIDER_TRANSIT_WEIGHT,
      })
        .slice(0, 5)
        .map((s) => {
          const drive = s.drive + tails[di];
          return {
            picks: s.picks.map((p) => ({ ...p, rider: members[p.rider] })),
            end: s.finalTime + tails[di],
            drive,
            pen: s.pen,
            extra: drive - direct[di],
          };
        })
        .filter((s) => Number.isFinite(s.end));
    }
    memo.set(key, sols);
    return sols;
  };
  // Score = when riders arrive on average + lambda * extra driving + rider transit penalty.
  // With one car this matches the per-car optimiser; with several it stops a rider being
  // sent the long way round just because another car sets the latest arrival anyway.
  const combine = (perDriver) => {
    const active = perDriver.filter((s) => s.picks.length);
    const end = Math.max(...active.map((s) => s.end));
    const meanEnd = active.reduce((a, s) => a + s.end * s.picks.length, 0) / riders.length;
    const extra = perDriver.reduce((a, s) => a + s.extra, 0);
    const pen = perDriver.reduce((a, s) => a + s.pen, 0);
    return { perDriver, end, extra, score: meanEnd + lambda * extra + pen };
  };

  // 4. choose which car takes whom
  const combos = [];
  for (const assign of assignments(riders.length, seats)) {
    const groups = drivers.map((_, di) => assign.flatMap((d, r) => (d === di ? [r] : [])));
    const options = groups.map((g, di) => solve(di, g));
    if (options.some((o) => !o.length)) continue;
    combos.push({ groups, options, ...combine(options.map((o) => o[0])) });
  }
  if (!combos.length) throw new Error('Could not find a drivable plan. Check that everyone is in a reachable place.');
  combos.sort((a, b) => a.score - b.score);
  const best = combos[0];

  // alternatives: other splits between cars, and other pickup spots for the chosen split
  const variants = combos.slice(0, 12);
  best.options.forEach((opts, di) =>
    opts.slice(1).forEach((alt) => variants.push(combine(best.options.map((o, j) => (j === di ? alt : o[0]))))),
  );
  variants.sort((a, b) => a.score - b.score);

  // 5. per-car timelines and rider instructions
  const buffer = PICKUP_BUFFER_S * 1000;
  const carPlans = await Promise.all(
    drivers.map(async (driver, di) => {
      const sol = best.perDriver[di];
      const chain = chains[di];
      const fin = finalFor(driver);

      // group consecutive picks at the same spot into one stop
      const stops = [];
      for (const p of sol.picks) {
        const last = stops.at(-1);
        if (last && last.idx === p.cand.idx) {
          last.riders.push(p);
          last.pickupAt = Math.max(last.pickupAt, p.pickupAt);
        } else stops.push({ idx: p.cand.idx, cand: p.cand, riders: [p], pickupAt: p.pickupAt });
      }
      // "ready" = when the driver needs to be there; pickup finishes one buffer later.
      // Leave so we reach the first stop exactly when it is ready, not earlier.
      for (const s of stops) s.readyAt = s.pickupAt - buffer;
      const leaveAt = stops.length ? Math.max(t0, stops[0].readyAt - dur(di, stops[0].idx)) : t0;
      let clock = leaveAt;
      let at = di;
      for (const s of stops) {
        s.driverEta = clock + dur(at, s.idx);
        clock = s.pickupAt;
        at = s.idx;
      }
      const chainEtas = chain.map((idx) => {
        clock += dur(at, idx);
        at = idx;
        return clock;
      });
      const lastPickupAt = stops.length ? stops.at(-1).pickupAt : null;
      const endAt = chainEtas.length ? chainEtas.at(-1) : lastPickupAt;

      const waypointPlaces = tripStops;
      const waypoints = waypointPlaces.map((p, i) => ({ label: p.label, lat: p.lat, lon: p.lon, eta: iso(chainEtas[i]), wazeUrl: wazeUrl(p) }));
      const destination = fin ? { ...fin, eta: iso(chainEtas.at(-1)), wazeUrl: wazeUrl(fin) } : null;

      // drawn in parallel with the rider re-plans below
      const routePts = [driver.place, ...stops.map((s) => s.cand), ...waypointPlaces, ...(fin ? [fin] : [])];
      const routeReq =
        routePts.length > 1 && !(routePts.length === 2 && sameSpot(routePts[0], routePts[1]))
          ? providers.driveRoute(routePts).catch((e) => {
              notes.push(`Could not draw ${driver.name}'s driving route: ${e.message}`);
              return null;
            })
          : Promise.resolve(null);

      const riderOut = await Promise.all(
        sol.picks.map(async (p) => {
          const rider = riders[p.rider];
          const c = p.cand;
          const stop = stops.find((s) => s.riders.includes(p));
          const pickupAt = stop.pickupAt;
          const meetAt = Math.max(stop.driverEta, stop.readyAt); // rider should be there by this time
          const base = {
            participantId: rider.id,
            name: rider.name,
            driverId: driver.id,
            driverName: driver.name,
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
              steps: [{ type: 'home', text: 'Stay where you are. The driver comes to you.' }],
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
                timeoutMs: 2500,
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

      const route = await routeReq;
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
      const mapsStops = [...stopsOut, ...waypoints];
      return {
        driver: {
          participantId: driver.id,
          name: driver.name,
          origin: driver.place,
          seats: seats[di],
          leaveAt: iso(leaveAt),
          lastPickupAt: lastPickupAt ? iso(lastPickupAt) : null,
          endAt: endAt ? iso(endAt) : null,
          driveMinutes: Math.round((sol.drive || 0) / 60000),
          stops: stopsOut,
          waypoints,
          destination,
          googleMapsUrl: mapsStops.length || fin ? gmapsDriveUrl(driver.place, mapsStops, fin) : null,
          route: route ? { coordinates: route.coordinates, km: +(route.distance / 1000).toFixed(1) } : null,
        },
        riders: riderOut,
      };
    }),
  );

  const seen = new Set();
  const alternatives = [];
  const signature = (c) => c.perDriver.map((s, di) => s.picks.map((p) => `${p.rider}@${di}:${p.cand.key}`).join('|')).join('/');
  for (const v of variants) {
    const sig = signature(v);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const activeDrive = v.perDriver.reduce((a, s) => a + (s.picks.length ? s.drive : 0), 0);
    alternatives.push({
      finalTime: iso(v.end),
      driveMinutes: Math.round(activeDrive / 60000),
      extraMinutes: Math.round((v.end - best.end) / 60000),
      pickups: v.perDriver.flatMap((s, di) =>
        s.picks.map((p) => ({
          rider: riders[p.rider].name,
          driver: drivers[di].name,
          place: p.cand.kind === 'home' ? `${riders[p.rider].name}'s location` : p.cand.name,
        })),
      ),
    });
    if (alternatives.length >= 4) break;
  }
  alternatives.shift(); // first one is the chosen plan

  const driversOut = carPlans.map((c) => c.driver);
  const active = driversOut.filter((d) => d.stops.length);
  const riderOut = riders.map((r) => carPlans.flatMap((c) => c.riders).find((x) => x.participantId === r.id));

  return {
    computedAt: new Date().toISOString(),
    departAfter: iso(t0),
    priority: input.priority || 'balanced',
    summary: {
      driverLeaveAt: iso(Math.min(...active.map((d) => Date.parse(d.leaveAt)))),
      lastPickupAt: iso(Math.max(...active.map((d) => Date.parse(d.lastPickupAt)))),
      finalArrival: iso(best.end),
      driveMinutes: active.reduce((a, d) => a + d.driveMinutes, 0),
      cars: active.length,
    },
    drivers: driversOut,
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
  MAX_DRIVERS,
  MAX_STOPS,
  MAX_SEATS,
};
