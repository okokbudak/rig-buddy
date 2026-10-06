// Rig Buddy Studio: the configuration page (http://127.0.0.1:62850/).
// Local only: it listens on the loopback address, answers only to its own
// address as Host (DNS rebinding) and its own origin, and every change needs a
// custom header a foreign web page can't send without our consent (CSRF).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { catalog, read } from './props.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 256 * 1024;

export function startStudio({ engine, hub, port = Number(process.env.RIGBUDDY_STUDIO_PORT || 62850) }) {
  const uiDir = path.join(import.meta.dirname, 'ui');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const sameOrigin = req => hosts.has(String(req.headers.host).toLowerCase()) && (req.headers.origin == null || req.headers.origin === `http://${req.headers.host}`);

  const readBody = req => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:",
      });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (!sameOrigin(req)) return send(403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers['x-studio'] !== '1') return send(403, { error: 'forbidden' });
        switch (`${req.method} ${url.pathname}`) {
          case 'GET /api/config': return send(200, { ...engine.config, rev: engine.rev });
          case 'GET /api/catalog': return send(200, catalog());
          case 'GET /api/status': return send(200, engine.status());
          case 'GET /api/ports': return send(200, await hub.ports());
          case 'PUT /api/config': {
            const next = JSON.parse(await readBody(req));
            // saved from an older revision (another tab, or a change made meanwhile): refuse, the editor reloads
            if (next.rev !== engine.rev) return send(409, { error: 'stale', rev: engine.rev });
            const saved = engine.apply(next);
            return send(200, { ...saved, rev: engine.rev });
          }
          case 'POST /api/eval': return send(200, engine.evaluate(JSON.parse(await readBody(req)).expr));
          case 'POST /api/test': {
            const b = JSON.parse(await readBody(req));
            return send(200, { ok: engine.testChannel(String(b.id), Number(b.channel), Number(b.ms) || 3000) });
          }
          case 'POST /api/nextion/nav': {
            const b = JSON.parse(await readBody(req));
            engine.nextionNav(String(b.id), String(b.action));
            return send(200, { ok: true });
          }
          case 'POST /api/probe': {
            const b = JSON.parse(await readBody(req));
            if (!/^COM\d{1,3}$/i.test(String(b.port))) return send(400, { error: 'bad port' });
            return send(200, await hub.probe(String(b.port).toUpperCase(), Number(b.baud) || 115200));
          }
          default: return send(404, { error: 'not found' });
        }
      }
      if (req.method !== 'GET') return send(405, { error: 'method' });
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.resolve(uiDir, rel);
      if (!file.startsWith(uiDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: 'not found' });
      return send(200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch (e) {
      return send(400, { error: e.message });
    }
  });

  // live values: the page says which properties it shows, we push them at 5 Hz
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: 64 * 1024, verifyClient: ({ req }) => sameOrigin(req) });
  wss.on('connection', ws => {
    let watch = [];
    ws.on('message', data => {
      try {
        const m = JSON.parse(data.toString());
        if (Array.isArray(m.watch)) watch = m.watch.slice(0, 400).filter(p => typeof p === 'string');
      } catch { /* ignore */ }
    });
    const push = () => {
      if (ws.readyState !== 1) return;
      const raw = engine.raw;
      const values = {};
      for (const p of watch) values[p] = read(raw, p) ?? null;
      ws.send(JSON.stringify({ status: engine.status(), values }));
    };
    const timer = setInterval(push, 200);
    engine.viewers++;
    ws.on('close', () => {
      clearInterval(timer);
      engine.viewers--;
    });
    push();
  });

  server.on('error', e => console.warn(`Studio: cannot listen on ${port}: ${e.message}`));
  server.listen(port, '127.0.0.1', () => console.log(`Rig Buddy Studio on http://127.0.0.1:${port}/`));
  return server;
}
