// Zero-dependency HTTP server: JSON API for shared trips + static PWA files.
// Run: node server/index.js   (PORT env var, default 3000)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi } = require('./api');

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

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
    size += c.length;
    if (size > 100_000) break; // handleApi rejects oversized bodies
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
  const body = req.method === 'GET' ? '' : await readBody(req);
  const [status, data] = await handleApi({ method: req.method, url, body, key: req.headers['x-key'] || null });
  send(res, status, data);
});
if (require.main === module) {
  server.listen(PORT, () => console.log(`Pickup Planner running on http://localhost:${PORT}`));
}

module.exports = { server };
