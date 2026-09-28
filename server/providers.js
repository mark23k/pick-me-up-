// External data sources. Each one is free and needs no API key:
//   - Transitous (MOTIS): public-transit routing, fed by Israel MOT's official GTFS.
//   - OSRM: driving durations and routes over OpenStreetMap.
//   - Nominatim + Transitous: address / stop search.
// All URLs are configurable so you can point at self-hosted instances in production.

const TRANSIT_URL = process.env.TRANSIT_URL || 'https://api.transitous.org';
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const USER_AGENT = process.env.USER_AGENT || 'pickup-planner/1.0 (github.com/pickup-planner)';
// Netlify stops a function after 10 s, so each call gets a budget that keeps a plan under that:
// transit lookups (parallel) + matrix + route/re-plans (parallel).
const TIMEOUT = { transit: 4500, matrix: 4000, route: 2500 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON within `timeoutMs` overall; one quick retry when the service says it's busy (429/503). */
async function getJson(url, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (res.ok) return res.json();
    const busy = res.status === 429 || res.status === 503;
    if (busy && attempt === 0 && deadline - Date.now() > 1500) {
      await wait(600);
      continue;
    }
    throw new Error(`${new URL(url).host} responded ${res.status}`);
  }
}

// Short-lived cache so Recalculate, several viewers and re-plans don't hammer the free
// services. Lives as long as the server (or a warm Netlify Function) does.
const cache = new Map(); // url -> { at, promise }
const CACHE_MAX = 500;
const TTL = { transit: 10 * 60e3, matrix: 10 * 60e3, geocode: 24 * 3600e3 };

function cachedJson(url, ttlMs, opts) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = getJson(url, opts).catch((e) => {
    cache.delete(url); // never cache failures
    throw e;
  });
  cache.delete(url); // re-insert so the Map stays in age order
  cache.set(url, { at: Date.now(), promise });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return promise;
}

const FIVE_MIN = 5 * 60e3;
const coord = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lon).toFixed(5)}`;

// ---------- Transit ----------

/**
 * Public-transit itineraries from `from` to `to`.
 * @param {{lat:number, lon:number}} from
 * @param {{lat:number, lon:number}} to
 * @param {{time: Date, arriveBy?: boolean, count?: number}} opts
 */
async function transitPlan(from, to, { time, arriveBy = false, count = 5, timeoutMs = TIMEOUT.transit }) {
  // Round the time to 5 minutes so nearby requests share a cache entry: later for
  // "leave after" (never suggests a bus that already left), earlier for "arrive by".
  const ms = time.getTime();
  const rounded = arriveBy ? Math.floor(ms / FIVE_MIN) * FIVE_MIN : Math.ceil(ms / FIVE_MIN) * FIVE_MIN;
  const qs = new URLSearchParams({
    fromPlace: coord(from),
    toPlace: coord(to),
    time: new Date(rounded).toISOString(),
    arriveBy: String(arriveBy),
    numItineraries: String(count),
    maxPreTransitTime: '1200', // walk at most 20 min to the first stop
    maxPostTransitTime: '1200',
  });
  const data = await cachedJson(`${TRANSIT_URL}/api/v1/plan?${qs}`, TTL.transit, { timeoutMs });
  return data.itineraries || [];
}

// ---------- Driving ----------

/** Full duration matrix (seconds) between points, via OSRM /table. */
async function driveMatrix(points) {
  if (points.length > 100) throw new Error('driveMatrix: at most 100 points');
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const data = await cachedJson(`${OSRM_URL}/table/v1/driving/${coords}?annotations=duration`, TTL.matrix, { timeoutMs: TIMEOUT.matrix });
  if (data.code !== 'Ok') throw new Error(`OSRM table: ${data.code}`);
  return data.durations; // durations[i][j] = seconds from i to j (null if unreachable)
}

/** Driving route through the given points in order. Returns GeoJSON coords + per-leg durations. */
async function driveRoute(points) {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const data = await getJson(
    `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`,
    { timeoutMs: TIMEOUT.route },
  );
  if (data.code !== 'Ok') throw new Error(`OSRM route: ${data.code}`);
  const r = data.routes[0];
  return {
    coordinates: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    legs: r.legs.map((l) => ({ duration: l.duration, distance: l.distance })),
    duration: r.duration,
    distance: r.distance,
  };
}

// ---------- Geocoding ----------

function areaName(r) {
  const a = (r.areas || []).find((x) => x.default) || (r.areas || []).at(-1);
  return a ? a.name : '';
}

/** Search for addresses, places and bus/train stops in Israel. */
async function geocode(text) {
  const tQs = new URLSearchParams({ text, language: 'he' });
  const nQs = new URLSearchParams({
    q: text,
    format: 'jsonv2',
    countrycodes: 'il',
    limit: '5',
    'accept-language': 'he,en',
  });
  const [t, n] = await Promise.allSettled([
    cachedJson(`${TRANSIT_URL}/api/v1/geocode?${tQs}`, TTL.geocode, { timeoutMs: 10000 }),
    cachedJson(`${NOMINATIM_URL}/search?${nQs}`, TTL.geocode, { timeoutMs: 10000 }),
  ]);
  const out = [];
  if (t.status === 'fulfilled') {
    for (const r of t.value) {
      if (r.country !== 'IL') continue;
      const street = r.street ? `${r.street} ${r.houseNumber || ''}`.trim() : '';
      const label = r.type === 'ADDRESS' ? street : r.name;
      const city = areaName(r);
      out.push({
        label: city && !label.includes(city) ? `${label}, ${city}` : label,
        type: r.type === 'STOP' ? 'stop' : r.type === 'ADDRESS' ? 'address' : 'place',
        lat: r.lat,
        lon: r.lon,
      });
    }
  }
  if (n.status === 'fulfilled') {
    for (const r of n.value) {
      out.push({
        label: r.display_name.split(',').slice(0, 3).join(',').trim(),
        type: 'address',
        lat: Number(r.lat),
        lon: Number(r.lon),
      });
    }
  }
  // Rank by how many of the typed words appear in the label (stable, so the
  // providers' own order breaks ties), then drop near-duplicates (~30 m).
  const words = text.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
  const hits = (r) => words.filter((w) => r.label.toLowerCase().includes(w)).length;
  out.sort((a, b) => hits(b) - hits(a));
  const seen = [];
  return out
    .filter((r) => {
      if (seen.some((s) => Math.abs(s.lat - r.lat) < 3e-4 && Math.abs(s.lon - r.lon) < 3e-4)) return false;
      seen.push(r);
      return true;
    })
    .slice(0, 8);
}

/** Human-readable label for a GPS position. */
async function reverseGeocode(lat, lon) {
  const qs = new URLSearchParams({ lat, lon, format: 'jsonv2', 'accept-language': 'he,en', zoom: '18' });
  try {
    const r = await cachedJson(`${NOMINATIM_URL}/reverse?${qs}`, TTL.geocode, { timeoutMs: 8000 });
    const a = r.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.suburb || '';
    return [street, city].filter(Boolean).join(', ') || r.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
  }
}

module.exports = { transitPlan, driveMatrix, driveRoute, geocode, reverseGeocode, _cache: cache };
