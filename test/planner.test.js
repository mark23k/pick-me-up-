const test = require('node:test');
const assert = require('node:assert/strict');
const { optimize, extractCandidates, itinerarySteps, decodePolyline, planTrip } = require('../server/planner');

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
  assert.equal(res.driver.stops.length, 1);
  assert.match(res.driver.stops[0].wazeUrl, /^https:\/\/waze\.com\/ul\?ll=/);
  assert.ok(Date.parse(res.driver.leaveAt) >= Date.parse(res.departAfter));
  assert.ok(Date.parse(res.summary.finalArrival) > Date.parse(res.driver.leaveAt));
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
