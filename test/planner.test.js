const test = require('node:test');
const assert = require('node:assert/strict');
const { optimize, extractCandidates, itinerarySteps, decodePolyline, planTrip, restTime } = require('../server/planner');

const MIN = 60000;
const T0 = Date.parse('2026-09-28T06:00:00Z');

test('single rider: meets on the bus line rather than making the driver go all the way', () => {
  // points: 0 driver, 1 rider home (60 min drive), 2 stop midway (20 min drive), 3 stop near driver (5 min drive)
  const m = [
    [0, 3600, 1200, 300],
    [3600, 0, 2400, 3300],
    [1200, 2400, 0, 900],
    [300, 3300, 900, 0],
  ];
  const riders = [
    {
      cands: [
        { idx: 1, arrival: T0, key: 'home' },
        { idx: 2, arrival: T0 + 40 * MIN, key: 'mid' },
        { idx: 3, arrival: T0 + 70 * MIN, key: 'near' },
      ],
    },
  ];
  const sols = optimize({ riders, matrix: m, startIdx: 0, destIdx: 0, t0: T0, lambda: 0.35, bufferS: 0 });
  // home: 60 + 60 back = 120 min. mid: max(20,40)+20 = 60 min. near: max(5,70)+5 = 75 min.
  assert.equal(sols[0].picks[0].cand.key, 'mid');
  assert.equal(sols[0].finalTime, T0 + 60 * MIN);
});

test('lessDriving priority prefers the stop closer to the driver', () => {
  const m = [
    [0, 1200, 300],
    [1200, 0, 900],
    [300, 900, 0],
  ];
  // far: meet at 20, home at 40, 40 min driving. near: meet at 45, home at 50, 10 min driving.
  const riders = [{ cands: [{ idx: 1, arrival: T0 + 20 * MIN, key: 'far' }, { idx: 2, arrival: T0 + 45 * MIN, key: 'near' }] }];
  const fast = optimize({ riders, matrix: m, startIdx: 0, destIdx: 0, t0: T0, lambda: 0, bufferS: 0 });
  const frugal = optimize({ riders, matrix: m, startIdx: 0, destIdx: 0, t0: T0, lambda: 1, bufferS: 0 });
  assert.equal(fast[0].picks[0].cand.key, 'far');
  assert.equal(frugal[0].picks[0].cand.key, 'near');
});

test('two riders: shared stop is used once and the best order is chosen', () => {
  // 0 driver, 1 shared stop (10 min), 2 rider B home (30 min)
  const m = [
    [0, 600, 1800],
    [600, 0, 1500],
    [1800, 1500, 0],
  ];
  const riders = [
    { cands: [{ idx: 1, arrival: T0 + 15 * MIN, key: 'shared' }] },
    { cands: [{ idx: 2, arrival: T0, key: 'homeB' }, { idx: 1, arrival: T0 + 20 * MIN, key: 'shared' }] },
  ];
  const sols = optimize({ riders, matrix: m, startIdx: 0, destIdx: 0, t0: T0, lambda: 0.35, bufferS: 120 });
  const best = sols[0];
  assert.deepEqual(best.picks.map((p) => p.cand.key), ['shared', 'shared']);
  // second rider arrives at 20, boards by 22, then 10 min home
  assert.equal(best.finalTime, T0 + 32 * MIN);
});

test('unreachable candidates (null durations) are skipped', () => {
  const m = [
    [0, null, 600],
    [null, 0, null],
    [600, null, 0],
  ];
  const riders = [{ cands: [{ idx: 1, arrival: T0, key: 'island' }, { idx: 2, arrival: T0, key: 'ok' }] }];
  const sols = optimize({ riders, matrix: m, startIdx: 0, destIdx: 0, t0: T0, lambda: 0.35 });
  assert.ok(sols.length > 0);
  assert.ok(sols.every((s) => s.picks[0].cand.key === 'ok'));
});

// ---------- itinerary handling ----------

const stop = (id, name, minute, extra = {}) => ({
  stopId: id,
  name,
  lat: 32 + minute / 1000,
  lon: 34.8,
  stopCode: String(1000 + minute),
  arrival: new Date(T0 + minute * MIN).toISOString(),
  departure: new Date(T0 + minute * MIN).toISOString(),
  ...extra,
});

const itinerary = {
  startTime: new Date(T0).toISOString(),
  endTime: new Date(T0 + 50 * MIN).toISOString(),
  legs: [
    {
      mode: 'WALK',
      from: { name: 'START', lat: 32, lon: 34.8 },
      to: stop('A', 'Stop A', 5),
      startTime: new Date(T0).toISOString(),
      endTime: new Date(T0 + 5 * MIN).toISOString(),
      duration: 300,
      distance: 400,
    },
    {
      mode: 'BUS',
      tripId: 'trip1',
      routeShortName: '480',
      headsign: 'Jerusalem',
      from: stop('A', 'Stop A', 5),
      to: stop('D', 'Stop D', 45),
      intermediateStops: [
        stop('B', 'Stop B', 15),
        stop('X', 'No-dropoff', 20, { dropoffType: 'NOT_ALLOWED' }),
        stop('C', 'Stop C', 30),
      ],
      startTime: new Date(T0 + 5 * MIN).toISOString(),
      endTime: new Date(T0 + 45 * MIN).toISOString(),
      duration: 2400,
    },
    {
      mode: 'WALK',
      from: stop('D', 'Stop D', 45),
      to: { name: 'END', lat: 32.05, lon: 34.8, arrival: new Date(T0 + 50 * MIN).toISOString() },
      startTime: new Date(T0 + 45 * MIN).toISOString(),
      endTime: new Date(T0 + 50 * MIN).toISOString(),
      duration: 300,
      distance: 350,
    },
  ],
};

test('candidates: every alighting stop, skipping no-dropoff stops, plus home', () => {
  const rider = { id: 'r', name: 'R', place: { lat: 32, lon: 34.8, label: 'Home' } };
  const c = extractCandidates(rider, [itinerary], T0);
  assert.deepEqual(c.map((x) => x.name), ['Home', 'Stop B', 'Stop C', 'Stop D']);
  assert.equal(c.find((x) => x.name === 'Stop C').arrival, T0 + 30 * MIN);
});

test('itinerary is truncated where the rider gets off', () => {
  const { steps, leaveAt, arriveAt } = itinerarySteps(itinerary, { legIndex: 1, stopIndex: 2, pickupName: 'Stop C', homeLabel: 'Home' });
  assert.equal(steps.length, 2);
  assert.equal(steps[0].type, 'walk');
  assert.equal(steps[0].from, 'Home');
  assert.equal(steps[1].line, '480');
  assert.equal(steps[1].to, 'Stop C');
  assert.equal(steps[1].stops, 3);
  assert.equal(leaveAt, itinerary.startTime);
  assert.equal(Date.parse(arriveAt), T0 + 30 * MIN);
});

test('polyline decoding (precision 5 reference value)', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts, [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

// ---------- end-to-end with fake providers ----------

test('planTrip end-to-end with stubbed providers', async () => {
  const driver = { id: 'd', name: 'Dana', place: { lat: 32.1, lon: 34.8, label: 'Driver home' } };
  const rider = { id: 'r', name: 'Roni', place: { lat: 32, lon: 34.8, label: 'Rider home' } };
  const providers = {
    transitPlan: async (from, to, { arriveBy }) => (arriveBy ? [] : [itinerary]),
    driveMatrix: async (points) =>
      points.map((a) => points.map((b) => Math.round(Math.hypot(a.lat - b.lat, a.lon - b.lon) * 20000))),
    driveRoute: async (pts) => ({ coordinates: pts.map((p) => [p.lat, p.lon]), legs: [], duration: 0, distance: 1000 }),
  };
  const res = await planTrip(
    { driver, riders: [rider], destination: { type: 'driverStart' }, departAfter: new Date(T0).toISOString(), priority: 'balanced', trafficFactor: 1 },
    { ...providers },
  );
  assert.equal(res.riders.length, 1);
  const d = res.drivers[0];
  assert.equal(d.stops.length, 1);
  assert.match(d.stops[0].wazeUrl, /^https:\/\/waze\.com\/ul\?ll=/);
  assert.ok(Date.parse(d.leaveAt) >= Date.parse(res.departAfter));
  assert.ok(Date.parse(res.summary.finalArrival) > Date.parse(d.leaveAt));
  // the rider either stays home or gets clear bus instructions ending at the pickup
  const r = res.riders[0];
  if (r.mode === 'transit') assert.equal(r.steps.at(-1).to, r.pickup.name);
});

test('planTrip reports who is missing a location', async () => {
  await assert.rejects(
    planTrip({ driver: { id: 'd', name: 'D', place: { lat: 1, lon: 1 } }, riders: [{ id: 'r', name: 'Avi' }] }, {}),
    /Avi/,
  );
});

// ---------- destination, stops and several drivers ----------

test('pickup spot leans toward the destination instead of the opposite way', () => {
  // 0 driver, 1 destination (30 min east of driver), 2 stop east (10 min from driver, 20 to dest), 3 stop west (10 min, 40 to dest)
  const m = [
    [0, 1800, 600, 600],
    [1800, 0, 1200, 2400],
    [600, 1200, 0, 1200],
    [600, 2400, 1200, 0],
  ];
  const riders = [{ cands: [{ idx: 2, arrival: T0 + 10 * MIN, key: 'east' }, { idx: 3, arrival: T0 + 10 * MIN, key: 'west' }] }];
  const sols = optimize({ riders, matrix: m, startIdx: 0, destIdx: 1, t0: T0, lambda: 0.35, bufferS: 0 });
  assert.equal(sols[0].picks[0].cand.key, 'east');
});

// Fake world: drive time is proportional to straight-line distance; no transit, so riders are picked up at home.
const flatProviders = {
  transitPlan: async () => [],
  driveMatrix: async (points) => points.map((a) => points.map((b) => Math.round(Math.hypot(a.lat - b.lat, a.lon - b.lon) * 20000))),
  driveRoute: async (pts) => ({ coordinates: pts.map((p) => [p.lat, p.lon]), legs: [], duration: 0, distance: 1000 }),
};
const at = (lat, label = '') => ({ lat, lon: 34.8, label });

test('several drivers: each rider goes with the car that suits them', async () => {
  const res = await planTrip(
    {
      drivers: [
        { id: 'a', name: 'Avi', place: at(32.0, 'Avi home') },
        { id: 'b', name: 'Bat', place: at(32.5, 'Bat home') },
      ],
      riders: [
        { id: 'r1', name: 'Near Bat', place: at(32.48) },
        { id: 'r2', name: 'Near Avi', place: at(32.03) },
      ],
      destination: { type: 'custom', place: at(32.3, 'Party') },
      departAfter: new Date(T0).toISOString(),
      trafficFactor: 1,
    },
    flatProviders,
  );
  const byName = Object.fromEntries(res.riders.map((r) => [r.name, r.driverName]));
  assert.deepEqual(byName, { 'Near Bat': 'Bat', 'Near Avi': 'Avi' });
  assert.equal(res.summary.cars, 2);
  assert.ok(res.drivers.every((d) => d.destination.label === 'Party'));
});

test('a driver who is far away is left without pickups', async () => {
  const res = await planTrip(
    {
      drivers: [
        { id: 'a', name: 'Close', place: at(32.0) },
        { id: 'b', name: 'Far', place: at(33.0) },
      ],
      riders: [{ id: 'r', name: 'Roni', place: at(32.02) }],
      destination: { type: 'custom', place: at(31.9, 'Beach') },
      departAfter: new Date(T0).toISOString(),
      trafficFactor: 1,
    },
    flatProviders,
  );
  assert.equal(res.riders[0].driverName, 'Close');
  assert.equal(res.drivers.find((d) => d.name === 'Far').stops.length, 0);
  assert.equal(res.summary.cars, 1);
});

test('stops on the way come after the pickups, in order, before the destination', async () => {
  const res = await planTrip(
    {
      drivers: [{ id: 'a', name: 'Avi', place: at(32.0) }],
      riders: [{ id: 'r', name: 'Roni', place: at(32.05) }],
      stops: [at(32.2, 'Gas'), at(32.3, 'Food')],
      destination: { type: 'custom', place: at(32.5, 'Eilat') },
      departAfter: new Date(T0).toISOString(),
      trafficFactor: 1,
    },
    flatProviders,
  );
  const d = res.drivers[0];
  assert.deepEqual(d.waypoints.map((w) => w.label), ['Gas', 'Food']);
  const times = [d.stops[0].pickupAt, ...d.waypoints.map((w) => w.eta), d.destination.eta].map(Date.parse);
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
  assert.equal(res.summary.finalArrival, d.destination.eta);
});

test('seats: a full car is not given more riders than it has seats', async () => {
  const riders = [1, 2, 3].map((i) => ({ id: `r${i}`, name: `R${i}`, place: at(32.0 + i / 1000) }));
  const res = await planTrip(
    {
      drivers: [
        { id: 'a', name: 'Small car', seats: 1, place: at(32.0) },
        { id: 'b', name: 'Van', seats: 6, place: at(32.2) },
      ],
      riders,
      destination: { type: 'custom', place: at(32.4, 'Dest') },
      departAfter: new Date(T0).toISOString(),
      trafficFactor: 1,
    },
    flatProviders,
  );
  assert.ok(res.riders.filter((r) => r.driverName === 'Small car').length <= 1);
  await assert.rejects(
    planTrip({ drivers: [{ id: 'a', name: 'A', seats: 2, place: at(32) }], riders, destination: { type: 'none' } }, flatProviders),
    (e) => e.code === 'notEnoughSeats' && /Not enough seats/.test(e.message),
  );
});

test('a rider is not sent on a two-hour bus ride when the car can collect them nearby', () => {
  // 0 driver, 1 destination (60 min), 2 rider home (5 min from driver, 62 to dest), 3 far stop on the way (30 min, 30 to dest)
  const m = [
    [0, 3600, 300, 1800],
    [3600, 0, 3720, 1800],
    [300, 3720, 0, 1900],
    [1800, 1800, 1900, 0],
  ];
  const riders = [
    {
      cands: [
        { idx: 2, arrival: T0, key: 'home' },
        { idx: 3, arrival: T0 + 30 * MIN, depart: T0 - 90 * MIN, key: 'farStop' }, // 2 h on buses
      ],
    },
  ];
  const noCost = optimize({ riders, matrix: m, startIdx: 0, destIdx: 1, t0: T0, lambda: 0.35, bufferS: 0 });
  const withCost = optimize({ riders, matrix: m, startIdx: 0, destIdx: 1, t0: T0, lambda: 0.35, bufferS: 0, mu: 0.25 });
  assert.equal(noCost[0].picks[0].cand.key, 'farStop');
  assert.equal(withCost[0].picks[0].cand.key, 'home');
});

test('slow timetable lookups give one clear note instead of an error per lookup', async () => {
  const res = await planTrip(
    {
      drivers: [{ id: 'a', name: 'Avi', place: at(32.0) }],
      riders: [
        { id: 'r1', name: 'Roni', place: at(32.05) },
        { id: 'r2', name: 'Dana', place: at(32.06) },
      ],
      destination: { type: 'custom', place: at(32.5, 'Haifa') },
      departAfter: new Date(T0).toISOString(),
      trafficFactor: 1,
    },
    { ...flatProviders, transitPlan: async () => { throw new Error('The operation was aborted due to timeout'); } },
  );
  assert.equal(res.notes.length, 1);
  assert.equal(res.notes[0].code, 'slowBus');
  assert.deepEqual(res.notes[0].params, { names: ['Roni', 'Dana'] });
  assert.equal(res.notes[0].text, 'Bus times for Roni and Dana were slow to load, so some bus options may be missing. Tap Recalculate to try again.');
});

// ---------- arrive-by ----------

test('arrive by: every car reaches the destination right on time, leaving as late as possible', async () => {
  const arriveBy = new Date(T0 + 6 * 60 * MIN).toISOString(); // Avi's drive alone is ~4.5 h in this fake world
  const res = await planTrip(
    {
      drivers: [
        { id: 'a', name: 'Avi', place: at(32.0) },
        { id: 'b', name: 'Bat', place: at(32.4) },
      ],
      riders: [
        { id: 'r1', name: 'Roni', place: at(32.02) },
        { id: 'r2', name: 'Dana', place: at(32.42) },
      ],
      stops: [at(32.6, 'Gas')],
      destination: { type: 'custom', place: at(32.8, 'Haifa') },
      arriveBy,
      now: T0,
      trafficFactor: 1,
    },
    flatProviders,
  );
  for (const d of res.drivers.filter((x) => x.stops.length)) {
    assert.equal(d.destination.eta, arriveBy);
    // 10 minutes at the stop on the way
    assert.equal(Date.parse(d.waypoints[0].leaveAt) - Date.parse(d.waypoints[0].eta), 10 * MIN);
    assert.ok(Date.parse(d.leaveAt) > T0 + 60 * MIN, 'leaves as late as possible, not at the start of planning');
  }
  assert.equal(res.summary.finalArrival, arriveBy);
  assert.equal(res.arriveBy, arriveBy);
  assert.ok(!res.notes.some((n) => n.code === 'cantMakeIt'));
});

test("arrive by: says so when the group can't make it in time", async () => {
  const res = await planTrip(
    {
      drivers: [{ id: 'a', name: 'Avi', place: at(32.0) }],
      riders: [{ id: 'r', name: 'Roni', place: at(32.02) }],
      destination: { type: 'custom', place: at(33.0, 'Far') }, // ~1 h 35 min of driving
      arriveBy: new Date(T0 + 30 * MIN).toISOString(),
      now: T0,
      trafficFactor: 1,
    },
    flatProviders,
  );
  assert.equal(res.notes[0].code, 'cantMakeIt');
  assert.match(res.notes[0].text, /can't all get there by .* earliest everyone can arrive/);
  await assert.rejects(
    planTrip({ drivers: [{ id: 'a', name: 'A', place: at(32) }], riders: [{ id: 'r', name: 'R', place: at(32.1) }], arriveBy: new Date(T0 - MIN).toISOString(), now: T0 }, flatProviders),
    /already passed/,
  );
});

// ---------- Shabbat & holidays ----------

test('Shabbat and holiday windows (Israel time)', () => {
  const il = (s) => Date.parse(`${s}+03:00`);
  assert.equal(restTime(il('2026-10-09T10:00:00')), null, 'Friday morning: buses run');
  assert.equal(restTime(il('2026-10-09T16:00:00')), 'shabbat', 'Friday afternoon');
  assert.equal(restTime(il('2026-10-10T12:00:00')), 'shabbat', 'Saturday midday');
  assert.equal(restTime(il('2026-10-10T21:00:00')), null, 'Saturday night: buses are back');
  assert.equal(restTime(il('2026-09-21T09:00:00')), 'holiday', 'Yom Kippur');
  assert.equal(restTime(il('2026-09-20T17:00:00')), 'holiday', 'Yom Kippur eve');
  assert.equal(restTime(il('2026-09-28T09:00:00')), null, 'Chol HaMoed Sukkot: buses run');
});

test('on Shabbat, one clear note instead of "no transit" per rider', async () => {
  const res = await planTrip(
    {
      drivers: [{ id: 'a', name: 'Avi', place: at(32.0) }],
      riders: [
        { id: 'r1', name: 'Roni', place: at(32.02) },
        { id: 'r2', name: 'Dana', place: at(32.03) },
      ],
      destination: { type: 'custom', place: at(32.3, 'Party') },
      departAfter: '2026-10-10T09:00:00Z', // Saturday midday in Israel
      now: Date.parse('2026-10-10T09:00:00Z'),
      trafficFactor: 1,
    },
    flatProviders,
  );
  assert.deepEqual(res.notes.map((n) => n.code), ['restDay']);
  assert.deepEqual(res.notes[0].params, { kind: 'shabbat', names: ['Roni', 'Dana'] });
});
