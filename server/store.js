// Tiny persistent trip store: in memory, flushed to a JSON file.
// Good for a single server instance; swap for Redis/Postgres/Firestore to scale out.

const fs = require('node:fs');
const path = require('node:path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'trips.json');
const TTL_MS = 3 * 24 * 60 * 60 * 1000; // trips expire after 3 days

let trips = new Map();
try {
  trips = new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
} catch {
  /* first run */
}

let timer = null;
function flush() {
  timer = null;
  const now = Date.now();
  for (const [id, t] of trips) if (now - Date.parse(t.updatedAt) > TTL_MS) trips.delete(id);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(trips)));
  fs.renameSync(tmp, FILE);
}

module.exports = {
  get(id) {
    const t = trips.get(id);
    if (t && Date.now() - Date.parse(t.updatedAt) > TTL_MS) return null;
    return t || null;
  },
  save(trip) {
    trips.set(trip.id, trip);
    if (!timer) timer = setTimeout(flush, 500);
  },
};
