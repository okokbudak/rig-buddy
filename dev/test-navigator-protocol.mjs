// Simulates the head-unit app's protocol against the local navigation server:
// auto-pair via /local/pairing-code -> app.redeemCode -> app.subscribeToDevice.
import { createRequire } from 'node:module';
// resolve 'ws' from the agent's dependencies (pc/agent/node_modules)
const WebSocket = createRequire(new URL('../pc/agent/package.json', import.meta.url))('ws');

const host = process.argv[2] ?? 'localhost';
const base = `http://${host}:62840`;

const { code } = await (await fetch(`${base}/local/pairing-code`)).json();
console.log('pairing code:', code);

const ws = new WebSocket(`ws://${host}:62840/navigator?connectionParams=1`, {
  headers: { Origin: 'http://ets2nav.local', 'User-Agent': 'ets2nav-test' },
});
let nextId = 1;
const send = (method, path, input) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params: { path, input } }));
  return id;
};

ws.on('open', () => {
  ws.send(JSON.stringify({ method: 'connectionParams', data: null }));
  send('mutation', 'app.redeemCode', { code });
});
ws.on('message', raw => {
  const s = raw.toString();
  if (s === 'PING') return ws.send('PONG');
  const msg = JSON.parse(s);
  console.log('<-', JSON.stringify(msg).slice(0, 400));
  if (msg.id === 1 && msg.result) {
    send('subscription', 'app.subscribeToDevice', undefined);
  }
});
ws.on('close', (c, r) => console.log('closed', c, r.toString()));
ws.on('error', e => console.log('error', e.message));
setTimeout(() => process.exit(0), 8000);
