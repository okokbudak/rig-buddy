// Exercises the search endpoints the app uses, as an extra navigator viewer.
import { createRequire } from 'node:module';
// resolve 'ws' from the agent's dependencies (pc/agent/node_modules)
const WebSocket = createRequire(new URL('../pc/agent/package.json', import.meta.url))('ws');

const host = process.argv[2] ?? 'localhost';
const { code } = await (await fetch(`http://${host}:62840/local/pairing-code`)).json();
const ws = new WebSocket(`ws://${host}:62840/navigator?connectionParams=1`, {
  headers: { Origin: 'http://ets2nav.local', 'User-Agent': 'ets2nav-test' },
});
let id = 0;
const pending = new Map();
const call = (method, path, input) =>
  new Promise(resolve => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params: { path, input } }));
  });
let lastPos;
ws.on('message', raw => {
  const s = raw.toString();
  if (s === 'PING') return ws.send('PONG');
  const m = JSON.parse(s);
  if (m.result?.data?.type === 'positionUpdate') lastPos = m.result.data.data;
  const r = pending.get(m.id);
  if (r && (m.error || m.result?.type === 'data')) { pending.delete(m.id); r(m.error ?? m.result.data); }
});
await new Promise(r => ws.on('open', r));
ws.send(JSON.stringify({ method: 'connectionParams', data: null }));
console.log('redeem', JSON.stringify(await call('mutation', 'app.redeemCode', { code })).slice(0, 80));
call('subscription', 'app.subscribeToDevice');
await new Promise(r => setTimeout(r, 1500));
const show = (label, res) => {
  if (!Array.isArray(res)) return console.log(label, JSON.stringify(res).slice(0, 300));
  console.log(`${label}: ${res.length} results`);
  for (const x of res.slice(0, 4)) console.log(`   ${x.label} [${x.type}] ${x.city?.name ?? x.stateName ?? ''} ${x.distance != null ? (x.distance / 1000).toFixed(1) + 'km' : ''} node=${x.nodeUid}`);
};
show('autocomplete "ankara"', await call('query', 'app.getAutocompleteOptions', 'ankara'));
show('autocomplete "berl"', await call('query', 'app.getAutocompleteOptions', 'berl'));
show('nearby fuel', await call('query', 'app.search', { type: 1, scope: 0 }));
show('nearby rest', await call('query', 'app.search', { type: 2, scope: 0 }));
console.log('truck pos', lastPos && JSON.stringify(lastPos.position));
show('synthesize at 29.25,41.20', await call('query', 'app.synthesizeSearchResult', [29.25, 41.2]));
process.exit(0);
