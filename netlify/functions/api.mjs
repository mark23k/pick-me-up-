// Netlify Function serving /api/* with the same routes as the Node server.
// Trips are stored in Netlify Blobs instead of a JSON file.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleApi, store } = require('../../server/api.js');

store.useBlobs();

export default async (req) => {
  const url = new URL(req.url);
  const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
  const [status, data] = await handleApi({ method: req.method, url, body, key: req.headers.get('x-key') });
  if (data.raw != null) {
    return new Response(data.raw, {
      status,
      headers: { 'Content-Type': data.contentType, 'Content-Disposition': `inline; filename="${data.filename}"`, 'Cache-Control': 'no-store' },
    });
  }
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/*' };
