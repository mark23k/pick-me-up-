// JSON API for shared trips, independent of the HTTP layer.
// Used by the Node server (server/index.js) and the Netlify Function (netlify/functions/api.mjs).

const crypto = require('node:crypto');
const providers = require('./providers');
const { planTrip, PRIORITY_WEIGHTS, MAX_RIDERS } = require('./planner');
const store = require('./store');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

function parseBody(raw) {
  if (!raw) return {};
  if (raw.length > 100_000) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(raw);
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

async function getTrip(id) {
  const trip = await store.get(id);
  if (!trip) throw new HttpError(404, 'Trip not found (links expire after 3 days)');
  return trip;
}

/** Any change to who/where/when makes the old plan stale. */
async function touch(trip, { invalidatePlan = true } = {}) {
  trip.updatedAt = new Date().toISOString();
  if (invalidatePlan && trip.plan) trip.plan.stale = true;
  await store.save(trip);
}

// ---------- routes ----------

const routes = [
  // create a trip; the creator joins as the first participant
  ['POST', /^\/api\/trips$/, async (b) => {
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
    await store.save(trip);
    return [201, { trip, participantId: creator.id }];
  }],

  ['GET', /^\/api\/trips\/([\w-]+)$/, async (b, [id]) => [200, { trip: await getTrip(id) }]],

  // trip settings
  ['PATCH', /^\/api\/trips\/([\w-]+)$/, async (b, [id]) => {
    const trip = await getTrip(id);
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
    await touch(trip);
    return [200, { trip }];
  }],

  // join
  ['POST', /^\/api\/trips\/([\w-]+)\/participants$/, async (b, [id]) => {
    const trip = await getTrip(id);
    if (trip.participants.length >= MAX_RIDERS + 1) throw new HttpError(400, 'This trip is full');
    const hasDriver = trip.participants.some((p) => p.role === 'driver');
    let role = b.role === 'driver' ? 'driver' : 'rider';
    if (role === 'driver' && hasDriver) throw new HttpError(400, 'This trip already has a driver');
    const p = { id: newId(), name: cleanName(b.name) || `Rider ${trip.participants.length}`, role, place: cleanPlace(b.place) };
    trip.participants.push(p);
    await touch(trip);
    return [201, { trip, participantId: p.id }];
  }],

  // update own name / role / location
  ['PATCH', /^\/api\/trips\/([\w-]+)\/participants\/([\w-]+)$/, async (b, [id, pid]) => {
    const trip = await getTrip(id);
    const p = trip.participants.find((x) => x.id === pid);
    if (!p) throw new HttpError(404, 'Participant not found');
    if ('name' in b) p.name = cleanName(b.name) || p.name;
    if ('place' in b) p.place = cleanPlace(b.place);
    if ('role' in b && b.role !== p.role) {
      if (b.role === 'driver' && trip.participants.some((x) => x.role === 'driver' && x.id !== pid)) {
        throw new HttpError(400, 'This trip already has a driver');
      }
      p.role = b.role === 'driver' ? 'driver' : 'rider';
    }
    await touch(trip);
    return [200, { trip }];
  }],

  ['DELETE', /^\/api\/trips\/([\w-]+)\/participants\/([\w-]+)$/, async (b, [id, pid]) => {
    const trip = await getTrip(id);
    trip.participants = trip.participants.filter((x) => x.id !== pid);
    await touch(trip);
    return [200, { trip }];
  }],

  // compute the plan
  ['POST', /^\/api\/trips\/([\w-]+)\/plan$/, async (b, [id]) => {
    const trip = await getTrip(id);
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
    await touch(trip, { invalidatePlan: false });
    return [200, { trip }];
  }],

  ['GET', /^\/api\/geocode$/, async (_b, _m, url) => {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return [200, { results: [] }];
    return [200, { results: await providers.geocode(q) }];
  }],

  ['GET', /^\/api\/reverse$/, async (_b, _m, url) => {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    return [200, { label: await providers.reverseGeocode(lat, lon) }];
  }],
];

/**
 * Handle one API request.
 * @param {{method: string, url: URL, body?: string}} req
 * @returns {Promise<[number, object]>} status and JSON body
 */
async function handleApi({ method, url, body }) {
  for (const [m, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (!match || method !== m) continue;
    try {
      return await handler(method === 'GET' ? {} : parseBody(body), match.slice(1), url);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return [e.status || 502, { error: e.message || 'Something went wrong' }];
    }
  }
  return [404, { error: 'Unknown API route' }];
}

module.exports = { handleApi, store };
