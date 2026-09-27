// JSON API for shared trips, independent of the HTTP layer.
// Used by the Node server (server/index.js) and the Netlify Function (netlify/functions/api.mjs).

const crypto = require('node:crypto');
const providers = require('./providers');
const { planTrip, PRIORITY_WEIGHTS, MAX_RIDERS, MAX_DRIVERS, MAX_STOPS, MAX_SEATS } = require('./planner');
const store = require('./store');

/** `code` + `params` let the app translate the message; `message` is the English fallback. */
class HttpError extends Error {
  constructor(status, message, code = null, params = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params;
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
  if (!(lat > 29 && lat < 33.5 && lon > 34 && lon < 36)) throw new HttpError(400, 'Location must be in Israel', 'notInIsrael');
  return { lat, lon, label: String(p.label || '').slice(0, 120) };
}

function cleanTime(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new HttpError(400, 'Bad time', 'badTime');
  return new Date(ms).toISOString();
}

function cleanStops(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Stops must be a list');
  if (list.length > MAX_STOPS) throw new HttpError(400, `At most ${MAX_STOPS} stops on the way`, 'tooManyStops', { n: MAX_STOPS });
  return list.map(cleanPlace).filter(Boolean);
}

const cleanSeats = (n) => Math.min(MAX_SEATS, Math.max(1, Math.round(Number(n)) || 4));

function checkRoomFor(trip, role, exceptId = null) {
  const others = trip.participants.filter((p) => p.id !== exceptId && p.role === role);
  if (role === 'driver' && others.length >= MAX_DRIVERS) throw new HttpError(400, `This trip already has ${MAX_DRIVERS} drivers`, 'tooManyDrivers', { n: MAX_DRIVERS });
  if (role === 'rider' && others.length >= MAX_RIDERS) throw new HttpError(400, `This trip already has ${MAX_RIDERS} people to pick up`, 'tooManyRiders', { n: MAX_RIDERS });
}

async function getTrip(id) {
  const trip = await store.get(id);
  if (!trip) throw new HttpError(404, 'Trip not found (links expire after 3 days)', 'notFound');
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
    if (creator.role === 'driver') creator.seats = cleanSeats(b.seats);
    const destPlace = cleanPlace(b.destination);
    const trip = {
      id: newId(),
      title: cleanName(b.title) || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      departAfter: null, // null = now
      arriveBy: cleanTime(b.arriveBy), // everyone at the destination by then (null = as soon as possible)
      priority: 'balanced',
      destination: destPlace ? { type: 'custom', place: destPlace } : { type: 'driverStart' },
      stops: cleanStops(b.stops || []),
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
    if ('departAfter' in b) trip.departAfter = cleanTime(b.departAfter);
    if ('arriveBy' in b) trip.arriveBy = cleanTime(b.arriveBy);
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
    if ('stops' in b) trip.stops = cleanStops(b.stops || []);
    await touch(trip);
    return [200, { trip }];
  }],

  // join
  ['POST', /^\/api\/trips\/([\w-]+)\/participants$/, async (b, [id]) => {
    const trip = await getTrip(id);
    const role = b.role === 'driver' ? 'driver' : 'rider';
    checkRoomFor(trip, role);
    const p = { id: newId(), name: cleanName(b.name) || `Rider ${trip.participants.length}`, role, place: cleanPlace(b.place) };
    if (role === 'driver') p.seats = cleanSeats(b.seats);
    trip.participants.push(p);
    await touch(trip);
    return [201, { trip, participantId: p.id }];
  }],

  // update own name / role / location
  ['PATCH', /^\/api\/trips\/([\w-]+)\/participants\/([\w-]+)$/, async (b, [id, pid]) => {
    const trip = await getTrip(id);
    const p = trip.participants.find((x) => x.id === pid);
    if (!p) throw new HttpError(404, 'Participant not found', 'participantNotFound');
    if ('name' in b) p.name = cleanName(b.name) || p.name;
    if ('place' in b) p.place = cleanPlace(b.place);
    if ('role' in b && b.role !== p.role) {
      const role = b.role === 'driver' ? 'driver' : 'rider';
      checkRoomFor(trip, role, pid);
      p.role = role;
      if (role === 'driver') p.seats ??= 4;
    }
    if ('seats' in b && p.role === 'driver') p.seats = cleanSeats(b.seats);
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
    const drivers = trip.participants.filter((p) => p.role === 'driver');
    if (!drivers.length) throw new HttpError(400, 'Someone needs to join as a driver.', 'needDriver');
    const riders = trip.participants.filter((p) => p.role === 'rider');
    try {
      trip.plan = await planTrip(
        {
          drivers,
          riders,
          destination: trip.destination,
          stops: trip.stops || [],
          departAfter: trip.departAfter,
          arriveBy: trip.arriveBy,
          priority: trip.priority,
        },
        providers,
      );
    } catch (e) {
      throw new HttpError(422, e.message, e.code || null, e.params || {});
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
      return [e.status || 502, { error: e.message || 'Something went wrong', code: e.code || 'generic', params: e.params || {} }];
    }
  }
  return [404, { error: 'Unknown API route' }];
}

module.exports = { handleApi, store };
