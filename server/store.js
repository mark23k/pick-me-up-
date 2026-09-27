// Trip store. Async API so the same routes run on both backends:
//  - Netlify (Functions): Netlify Blobs, one blob per trip.
//  - Plain Node server:   in memory, flushed to a JSON file (single instance).

const fs = require('node:fs');
const path = require('node:path');

const TTL_MS = 3 * 24 * 60 * 60 * 1000; // trips expire after 3 days
const expired = (t) => Date.now() - Date.parse(t.updatedAt) > TTL_MS;

function blobStore() {
  const { getStore } = require('@netlify/blobs');
  const blobs = getStore({ name: 'trips', consistency: 'strong' });
  return {
    async get(id) {
      const t = await blobs.get(id, { type: 'json' });
      if (t && expired(t)) {
        await blobs.delete(id);
        return null;
      }
      return t || null;
    },
    async save(trip) {
      await blobs.setJSON(trip.id, trip);
    },
  };
}

function fileStore() {
  const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'trips.json');
  let trips = new Map();
  try {
    trips = new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
  } catch {
    /* first run */
  }

  let timer = null;
  function flush() {
    timer = null;
    for (const [id, t] of trips) if (expired(t)) trips.delete(id);
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(trips)));
    fs.renameSync(tmp, FILE);
  }

  return {
    async get(id) {
      const t = trips.get(id);
      return t && !expired(t) ? t : null;
    },
    async save(trip) {
      trips.set(trip.id, trip);
      if (!timer) timer = setTimeout(flush, 500);
    },
  };
}

let backend = null;
const current = () => (backend ||= fileStore());

module.exports = {
  get: (id) => current().get(id),
  save: (trip) => current().save(trip),
  /** Called by the Netlify Function before handling requests. */
  useBlobs() {
    backend = blobStore();
  },
};
