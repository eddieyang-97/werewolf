import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRooms, RoomError } from './rooms.js';
import { roles } from '../public/boards.js';

const artwork = new Set(['home', 'room', 'empty-seat', ...Object.entries(roles).map(([key, role]) => role.art ?? key)]);

const files = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/boards.js': ['boards.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
  ...Object.fromEntries([...artwork].map(name => [`/art/${name}.png`, [`art/${name}.png`, 'image/png']])),
};
const roomPattern = '[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}';
const apiRoute = new RegExp(`^/api/rooms/(${roomPattern})(?:/(join|resume|sync|action|disconnect))?$`);
const roomPage = new RegExp(`^/room/${roomPattern}/?$`);
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function respond(res, status, value) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RoomError(415, 'CONTENT_TYPE', '请求格式不正确。');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8_192) throw new RoomError(413, 'BODY_SIZE', '请求过大。');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Use the same validation response for invalid JSON and non-object bodies.
  }
  throw new RoomError(400, 'JSON', '请求格式不正确。');
}

export function createApp(store, { clock = Date.now, revision = 'local' } = {}) {
  const rooms = createRooms(store, clock);
  const boot = randomUUID();
  const assets = new Map(Object.entries(files).map(([path, [file, contentType]]) => [
    path,
    [readFileSync(new URL(`../public/${file}`, import.meta.url)), contentType],
  ]));
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/healthz') {
        await store.ready?.();
        respond(res, 200, { status: 'ok', boot, revision });
        return;
      }
      const isAppPage = roomPage.test(path) || path === '/create' || path === '/join';
      const asset = isAppPage ? assets.get('/') : assets.get(path);
      if (req.method === 'GET' && asset) {
        const [body, type] = asset;
        res.writeHead(200, {
          ...securityHeaders,
          'Content-Type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
          ...(type === 'image/png' ? { 'Cache-Control': 'public, max-age=3600' } : {}),
        });
        res.end(body);
        return;
      }
      const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]+)$/)?.[1];
      if (req.method === 'POST' && path === '/api/rooms') {
        const { board, name, tab } = await jsonBody(req);
        respond(res, 201, await rooms.create(board, name, token, tab));
        return;
      }
      const match = apiRoute.exec(path);
      if (match) {
        const [, code, operation] = match;
        if (req.method === 'GET' && !operation) {
          respond(res, 200, await rooms.info(code));
          return;
        }
        if (req.method === 'POST' && operation) {
          const { tab, name, command } = await jsonBody(req);
          let result;
          switch (operation) {
            case 'join': result = await rooms.join(code, name, token, tab); break;
            case 'resume': result = await rooms.sync(code, token, tab, true); break;
            case 'sync': result = await rooms.sync(code, token, tab); break;
            case 'disconnect': result = await rooms.disconnect(code, token, tab); break;
            case 'action': result = await rooms.action(code, token, tab, command ?? {}); break;
          }
          respond(res, 200, result);
          return;
        }
      }
      respond(res, 404, { code: 'NOT_FOUND', message: '页面不存在。' });
    } catch (error) {
      if (error instanceof RoomError) {
        respond(res, error.status, { code: error.code, message: error.message });
      } else {
        console.error('Request failed:', error.name);
        respond(res, 500, { code: 'SERVER', message: '服务暂时不可用，请重试。' });
      }
    }
  });
}
