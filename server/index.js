// Zero-dependency HTTP server: JSON API for shared trips + static PWA files.
// Run: node server/index.js   (PORT env var, default 3000)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const providers = require('./providers');
const { planTrip, PRIORITY_WEIGHTS, MAX_RIDERS } = require('./planner');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const cleanName = (s) => String(s || '').trim().slice(0, 40);

function cleanPlace(p) {
  if (!p) return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  // Israel incl. Eilat and the Golan, with some margin.
  if (!(lat > 29 && lat < 33.5 && lon > 34 && lon < 36)) throw new HttpError(400, 'Location must be in Israel');
  return { lat, lon, label: String(p.label || '').slice(0, 120) };
}

function getTrip(id) {
  const trip = store.get(id);
  if (!trip) throw new HttpError(404, 'Trip not found (links expire after 3 days)');
  return trip;
}

/** Any change to who/where/when makes the old plan stale. */
function touch(trip, { invalidatePlan = true } = {}) {
  trip.updatedAt = new Date().toISOString();
  if (invalidatePlan && trip.plan) trip.plan.stale = true;
  store.save(trip);
}

// ---------- routes ----------

const routes = [
  // create a trip; the creator joins as the first participant
  ['POST', /^\/api\/trips$/, async (req) => {
    const b = await readBody(req);
    const creator = {
      id: newId(),
      name: cleanName(b.name) || 'Me',
      role: b.role === 'rider' ? 'rider' : 'driver',
      place: cleanPlace(b.place),
    };
    const trip = {
      id: newId(),
      title: cleanName(b.title) || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      departAfter: null, // null = now
      priority: 'balanced',
      destination: { type: 'driverStart' },
      participants: [creator],
      plan: null,
    };
    store.save(trip);
    return [201, { trip, participantId: creator.id }];
  }],

  ['GET', /^\/api\/trips\/([\w-]+)$/, async (req, [id]) => [200, { trip: getTrip(id) }]],

  // trip settings
  ['PATCH', /^\/api\/trips\/([\w-]+)$/, async (req, [id]) => {
    const trip = getTrip(id);
    const b = await readBody(req);
    if ('title' in b) trip.title = cleanName(b.title);
    if ('departAfter' in b) {
      if (b.departAfter && Number.isNaN(Date.parse(b.departAfter))) throw new HttpError(400, 'Bad time');
      trip.departAfter = b.departAfter || null;
    }
    if ('priority' in b) {
      if (!(b.priority in PRIORITY_WEIGHTS)) throw new HttpError(400, 'Bad priority');
      trip.priority = b.priority;
    }
    if ('destination' in b) {
      const d = b.destination || {};
      if (d.type === 'custom') trip.destination = { type: 'custom', place: cleanPlace(d.place) };
      else if (d.type === 'none') trip.destination = { type: 'none' };
      else trip.destination = { type: 'driverStart' };
    }
    touch(trip);
    return [200, { trip }];
  }],

  // join
  ['POST', /^\/api\/trips\/([\w-]+)\/participants$/, async (req, [id]) => {
    const trip = getTrip(id);
    const b = await readBody(req);
    if (trip.participants.length >= MAX_RIDERS + 1) throw new HttpError(400, 'This trip is full');
    const hasDriver = trip.participants.some((p) => p.role === 'driver');
    let role = b.role === 'driver' ? 'driver' : 'rider';
    if (role === 'driver' && hasDriver) throw new HttpError(400, 'This trip already has a driver');
    const p = { id: newId(), name: cleanName(b.name) || `Rider ${trip.participants.length}`, role, place: cleanPlace(b.place) };
    trip.participants.push(p);
    touch(trip);
    return [201, { trip, participantId: p.id }];
  }],

  // update own name / role / location
  ['PATCH', /^\/api\/trips\/([\w-]+)\/participants\/([\w-]+)$/, async (req, [id, pid]) => {
    const trip = getTrip(id);
    const p = trip.participants.find((x) => x.id === pid);
    if (!p) throw new HttpError(404, 'Participant not found');
    const b = await readBody(req);
    if ('name' in b) p.name = cleanName(b.name) || p.name;
    if ('place' in b) p.place = cleanPlace(b.place);
    if ('role' in b && b.role !== p.role) {
      if (b.role === 'driver' && trip.participants.some((x) => x.role === 'driver' && x.id !== pid)) {
        throw new HttpError(400, 'This trip already has a driver');
      }
      p.role = b.role === 'driver' ? 'driver' : 'rider';
    }
    touch(trip);
    return [200, { trip }];
  }],

  ['DELETE', /^\/api\/trips\/([\w-]+)\/participants\/([\w-]+)$/, async (req, [id, pid]) => {
    const trip = getTrip(id);
    trip.participants = trip.participants.filter((x) => x.id !== pid);
    touch(trip);
    return [200, { trip }];
  }],

  // compute the plan
  ['POST', /^\/api\/trips\/([\w-]+)\/plan$/, async (req, [id]) => {
    const trip = getTrip(id);
    const driver = trip.participants.find((p) => p.role === 'driver');
    if (!driver) throw new HttpError(400, 'Someone needs to join as the driver.');
    const riders = trip.participants.filter((p) => p.role === 'rider');
    try {
      trip.plan = await planTrip(
        {
          driver,
          riders,
          destination: trip.destination,
          departAfter: trip.departAfter,
          priority: trip.priority,
        },
        providers,
      );
    } catch (e) {
      throw new HttpError(422, e.message);
    }
    touch(trip, { invalidatePlan: false });
    return [200, { trip }];
  }],

  ['GET', /^\/api\/geocode$/, async (req, _m, url) => {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return [200, { results: [] }];
    return [200, { results: await providers.geocode(q) }];
  }],

  ['GET', /^\/api\/reverse$/, async (req, _m, url) => {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    return [200, { label: await providers.reverseGeocode(lat, lon) }];
  }],
];

// ---------- static files ----------

function serveStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel.startsWith('/t/')) rel = '/index.html'; // SPA routes
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
  for (const [method, pattern, handler] of routes) {
    const m = url.pathname.match(pattern);
    if (!m || req.method !== method) continue;
    try {
      const [status, body] = await handler(req, m.slice(1), url);
      return send(res, status, body);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return send(res, e.status || 502, { error: e.message || 'Something went wrong' });
    }
  }
  send(res, 404, { error: 'Unknown API route' });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Pickup Planner running on http://localhost:${PORT}`));
}

module.exports = { server };
