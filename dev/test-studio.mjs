// Studio formula language + engine line building, no game or PC app needed:
//   vendor\node\node.exe dev\test-studio.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine, normalize } from '../pc/agent/studio/engine.mjs';
import { compile, FormulaError } from '../pc/agent/studio/expr.mjs';
import { catalog, read } from '../pc/agent/studio/props.mjs';

const raw = {
  truck: { speed: { kph: 87.4 }, engine: { rpm: { value: 1500, max: 2500 }, enabled: true }, fuel: { value: 200, capacity: 400 }, adBlue: { value: 20, capacity: 100 }, brakes: { airPressure: { value: 100 } } },
  controls: { game: { throttle: 0.5 } },
};
const ev = (src, r = raw) => compile(src)(p => read(r, p));

// arithmetic, precedence, booleans
assert.equal(ev('1 + 2 * 3'), 7);
assert.equal(ev('(1 + 2) * 3'), 9);
assert.equal(ev('2 ** 3 ** 2'), 512); // right-associative
assert.equal(ev('-2 ** 2'), 4); // unary binds tighter, like the parser's grammar here
assert.equal(ev('10 % 4'), 2);
assert.equal(ev('true + true'), 2);
assert.equal(ev('1 < 2 && 2 < 3'), true);
assert.equal(ev('0 || 5'), 5);
assert.equal(ev('!0'), true);
assert.equal(ev('1 ? "a" : "b"'), 'a');
assert.equal(ev('"x" + 1'), 'x1');
// telemetry paths and the SimHub-style gauge formulas
assert.equal(ev('truck.speed.kph * 10'), 874);
assert.equal(ev('truck.fuel.value / max(truck.fuel.capacity, 1) * 100'), 50);
assert.equal(ev('x.airBar * 100'), 100 * 0.0689476 * 100);
assert.ok(Math.abs(ev('controls.game.throttle * (truck.engine.rpm.value / max(truck.engine.rpm.max, 1)) * 3 * 1000') - 900) < 1e-9);
assert.equal(ev('truck.engine.enabled ? 1 : 0'), 1);
assert.equal(ev('truck.does.not.exist + 1'), 1); // missing = 0
assert.equal(ev('x.gameRunning', null), false);
assert.equal(ev('truck.speed.kph', null), undefined);
// functions
assert.equal(ev('round(2.567, 1)'), 2.6);
assert.equal(ev('clamp(150, 0, 100)'), 100);
assert.equal(ev('map(50, 0, 100, 0, 240)'), 120);
assert.equal(ev('map(500, 0, 100, 0, 240)'), 240);
assert.equal(ev('format(3.14159, 2)'), '3.14');
assert.equal(ev('pad(7, 3)'), '007');
// own properties only: no prototype walking
assert.equal(read({ a: {} }, 'a.constructor'), undefined);
assert.equal(read({}, '__proto__'), undefined);
// errors
for (const bad of ['1 +', '(1', 'foo(1)', '1 $ 2', '"abc', '1 2', '']) {
  assert.throws(() => compile(bad), FormulaError, bad);
}
assert.throws(() => compile('nope(1)'), /unknown function nope/);

// catalog: complete before any game runs
const cat = catalog();
assert.ok(cat.length > 700, `catalog has ${cat.length} entries`);
for (const p of ['truck.speed.kph', 'truck.engine.rpm.value', 'truck.brakes.airPressure.value', 'controls.game.throttle', 'x.fuelPercent']) {
  assert.ok(cat.some(c => c.path === p), `catalog lacks ${p}`);
}

// normalize: hostile/old input
const n = normalize({ serial: [{ id: 'A b!', port: 'com11', baud: 5, hz: 999, terminator: 'x', idle: 'zzz', channels: [{ expr: 'x'.repeat(900), min: '', max: '5' }] }, { id: 'ab' }] });
assert.equal(n.serial[0].id, 'ab');
assert.equal(n.serial[1].id, 'ab_'); // unique
assert.equal(n.serial[0].port, 'COM11');
assert.equal(n.serial[0].baud, 115200);
assert.equal(n.serial[0].hz, 25);
assert.equal(n.serial[0].terminator, '\\n');
assert.equal(n.serial[0].idle, 'zeros');
assert.equal(n.serial[0].channels[0].expr.length, 500);
assert.equal(n.serial[0].channels[0].min, null);
assert.equal(n.serial[0].channels[0].max, 5);
assert.equal(normalize({ serial: [{ port: 'rm -rf' }] }).serial[0].port, '');

// engine: a fake hub records what would go to the Arduino
const written = [];
const hub = Object.assign(new EventEmitter(), {});
const fake = {
  events: hub, connected: true,
  open: (id, port, baud) => { written.push(['open', id, port, baud]); queueMicrotask(() => hub.emit('state', { id, state: 'open' })); return true; },
  close: id => written.push(['close', id]),
  write: (id, data) => written.push(['write', id, data]),
  ports: async () => ({ ports: [] }), probe: async () => ({}),
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
let current = raw;
const engine = createEngine({ hub: fake, getRaw: () => current, dataDir: dir });
assert.equal(engine.config.serial.length, 2); // the seeded cluster 1/2
assert.equal(engine.config.serial[0].enabled, false);
const cfg = structuredClone(engine.config);
cfg.serial[1].enabled = true;
cfg.serial[1].port = 'COM14';
engine.apply(cfg);
assert.deepEqual(written.shift(), ['open', 'cluster2', 'COM14', 115200]);
await new Promise(r => setTimeout(r, 120)); // some ticks
const lines = written.filter(w => w[0] === 'write').map(w => w[2]);
assert.ok(lines.length >= 1, 'a line was sent');
assert.equal(lines[0], '874,200,500\n'); // speed x10, adblue% x10, fuel% x10
// unchanged values are not resent at tick speed, but the gauges' keep-alive repeats them
const before = written.filter(w => w[0] === 'write').length;
await new Promise(r => setTimeout(r, 300));
const after = written.filter(w => w[0] === 'write').length;
assert.ok(after - before <= 2, `unchanged line resent ${after - before}x in 300 ms`);
// game closes: zeros
current = null;
await new Promise(r => setTimeout(r, 150));
assert.equal(written.filter(w => w[0] === 'write').at(-1)[2], '0,0,0\n');
// a port change reopens, disabling closes
const c2 = structuredClone(engine.config);
c2.serial[1].port = 'COM15';
engine.apply(c2);
assert.deepEqual(written.filter(w => w[0] !== 'write').slice(-2), [['close', 'cluster2'], ['open', 'cluster2', 'COM15', 115200]]);
c2.serial[1].enabled = false;
engine.apply(c2);
assert.deepEqual(written.at(-1), ['close', 'cluster2']);
// the file survives a restart
const again = createEngine({ hub: fake, getRaw: () => null, dataDir: dir });
assert.equal(again.config.serial[1].port, 'COM15');
console.log('studio: all tests passed');
process.exit(0);
