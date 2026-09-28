const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_FILE = path.join(os.tmpdir(), `pp-api-test-${process.pid}.json`);
const { handleApi, store } = require('../server/api');

const call = async (method, p, body, key) => {
  const [status, data] = await handleApi({ method, url: new URL(`http://x${p}`), body: body && JSON.stringify(body), key });
  return { status, ...data };
};
const place = (lat) => ({ lat, lon: 34.8, label: `at ${lat}` });

async function tripWithTwo() {
  const org = await call('POST', '/api/trips', { name: 'Org', role: 'driver', destination: place(32.5) });
  const joined = await call('POST', `/api/trips/${org.trip.id}/participants`, { name: 'Rider', role: 'rider' });
  return { id: org.trip.id, orgKey: org.key, orgId: org.participantId, riderKey: joined.key, riderId: joined.participantId };
}

test('keys are handed out once and never appear in trip data', async () => {
  const { id, orgKey, riderKey } = await tripWithTwo();
  assert.ok(orgKey && riderKey && orgKey !== riderKey);
  const { trip } = await call('GET', `/api/trips/${id}`);
  assert.ok(trip.participants.every((p) => !('key' in p)));
  assert.equal(JSON.stringify(trip).includes(orgKey), false);
});

test('only the organizer changes trip settings', async () => {
  const { id, orgKey, riderKey } = await tripWithTwo();
  assert.equal((await call('PATCH', `/api/trips/${id}`, { priority: 'fastest' }, riderKey)).code, 'organizerOnly');
  assert.equal((await call('PATCH', `/api/trips/${id}`, { priority: 'fastest' })).status, 403);
  assert.equal((await call('PATCH', `/api/trips/${id}`, { priority: 'fastest' }, orgKey)).status, 200);
});

test('people change themselves; the organizer can change or remove anyone but themselves', async () => {
  const { id, orgKey, orgId, riderKey, riderId } = await tripWithTwo();
  assert.equal((await call('PATCH', `/api/trips/${id}/participants/${riderId}`, { place: place(32.1) }, riderKey)).status, 200);
  assert.equal((await call('PATCH', `/api/trips/${id}/participants/${orgId}`, { place: place(32.1) }, riderKey)).status, 403);
  assert.equal((await call('PATCH', `/api/trips/${id}/participants/${riderId}`, { name: 'R2' }, orgKey)).status, 200);
  assert.equal((await call('DELETE', `/api/trips/${id}/participants/${orgId}`, null, orgKey)).code, 'organizerStays');
  assert.equal((await call('DELETE', `/api/trips/${id}/participants/${riderId}`, null, orgKey)).status, 200);
});

test('a confirmed plan is locked until the organizer unlocks it', async () => {
  const { id, orgKey, riderKey } = await tripWithTwo();
  assert.equal((await call('POST', `/api/trips/${id}/confirm`, {}, orgKey)).code, 'planStale', 'nothing to confirm yet');
  (await store.get(id)).plan = { computedAt: new Date().toISOString(), notes: [] };
  assert.equal((await call('POST', `/api/trips/${id}/confirm`, {}, riderKey)).status, 403);
  const confirmed = await call('POST', `/api/trips/${id}/confirm`, {}, orgKey);
  assert.equal(confirmed.trip.locked.by, 'Org');
  assert.equal((await call('POST', `/api/trips/${id}/plan`, {}, orgKey)).code, 'planLocked');
  // a change after confirming marks the plan stale but keeps it locked
  const moved = await call('PATCH', `/api/trips/${id}/participants/${(await store.get(id)).participants[1].id}`, { place: place(32.2) }, riderKey);
  assert.equal(moved.trip.plan.stale, true);
  assert.ok(moved.trip.locked);
  assert.equal((await call('POST', `/api/trips/${id}/unlock`, {}, riderKey)).status, 403);
  assert.equal((await call('POST', `/api/trips/${id}/unlock`, {}, orgKey)).trip.locked, null);
});

test('trips from before organizers existed stay open to everyone', async () => {
  const { id } = await tripWithTwo();
  const trip = await store.get(id);
  delete trip.organizerId;
  trip.participants.forEach((p) => delete p.key);
  assert.equal((await call('PATCH', `/api/trips/${id}`, { priority: 'fastest' })).status, 200);
});
