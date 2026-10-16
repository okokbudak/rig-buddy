// Studio formula language + engine line building, no game or PC app needed:
//   vendor\node\node.exe dev\test-studio.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine, normalize } from '../pc/agent/studio/engine.mjs';
import { createRenderer, EFFECTS } from '../pc/agent/studio/leds.mjs';
import { hasLedFrames, normalizeLeds, ledCommand, parseCfg, parseHello, normalizeMotor, motorCommand, motorDiff, hasHomeOffset, hasIdle, normalizeSleep, idleCommand } from '../pc/agent/studio/board.mjs';
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
assert.equal(engine.config.serial.length, 0); // a fresh install starts empty
assert.equal(engine.config.nextion.length, 0);
const cfg = structuredClone(engine.config);
cfg.serial.push({
  id: 'gauges', name: 'Gauges', enabled: true, port: 'COM14', baud: 115200, hz: 25, separator: ',', terminator: '\\n', idle: 'zeros',
  channels: [
    { name: 'SPEED (km/h x10)', expr: 'truck.speed.kph * 10', min: 0, max: 1200 },
    { name: 'ADBLUE (% x10)', expr: 'x.adBluePercent * 10', min: 0, max: 1000 },
    { name: 'FUEL (% x10)', expr: 'x.fuelPercent * 10', min: 0, max: 1000 },
  ],
});
engine.apply(cfg);
assert.deepEqual(written.shift(), ['open', 'gauges', 'COM14', 115200]);
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
c2.serial[0].port = 'COM15';
engine.apply(c2);
assert.deepEqual(written.filter(w => w[0] !== 'write').slice(-2), [['close', 'gauges'], ['open', 'gauges', 'COM15', 115200]]);
c2.serial[0].enabled = false;
engine.apply(c2);
assert.deepEqual(written.at(-1), ['close', 'gauges']);
// the file survives a restart
const again = createEngine({ hub: fake, getRaw: () => null, dataDir: dir });
assert.equal(again.config.serial[0].port, 'COM15');
// --- Nextion ---------------------------------------------------------------------------------
// A small test display with the mechanics a Nextion cluster needs: pages with bindings (txt / vis / val), a touch
// strip along the bottom, an idle page and power-off while no game runs.
const NX = {
  id: 'scania', name: 'Test display', enabled: false, port: '', baud: 115200, width: 480, height: 272,
  powerOffWhenIdle: true, idlePage: 'page1',
  pages: ['page1', 'page3', 'page4', 'page5'].map(name => ({ name, rotation: true, showWhen: '' })),
  hotspots: [{ x: 50, y: 86, w: 50, h: 14, action: 'next' }, { x: 0, y: 86, w: 50, h: 14, action: 'prev' }],
  bindings: [
    { target: 'page1.pblinkl.vis', expr: 'truck.lights.blinker.left.enabled' },
    { target: 'page1.pblinkr.vis', expr: 'truck.lights.blinker.right.enabled' },
    { target: 'page1.pr2.vis', expr: 'truck.brakes.retarder.level >= 2' },
    { target: 'page1.pr3.vis', expr: 'truck.brakes.retarder.level >= 3' },
    { target: 'page1.tclock.txt', expr: 'x.gameClock' },
    { target: 'page1.j0.val', expr: 'x.fuelPercent' },
    { target: 'page1.trange.txt', expr: 'truck.fuel.range', decimals: 0 },
    { target: 'page1.tgear.txt', expr: 'x.gearText' },
    { target: 'page1.tcruise.txt', expr: "truck.cruiseControl.enabled ? round(truck.cruiseControl.kph, 0) : ''", decimals: 0 },
    { target: 'page1.tlimit.txt', expr: "navigation.speedLimit.kph > 0 ? navigation.speedLimit.kph : ''", decimals: 0 },
    { target: 'page3.tair.txt', expr: 'x.airBar', decimals: 1 },
    { target: 'page3.jair.val', expr: 'min(100, x.airBar / 13 * 100)' },
    { target: 'page3.twat.txt', expr: 'truck.engine.waterTemperature.value', decimals: 0 },
    { target: 'page3.toil.txt', expr: 'truck.engine.oilTemperature.value', decimals: 0 },
    { target: 'page4.tdeng.txt', expr: 'truck.damage.engine * 100', decimals: 0 },
    { target: 'page4.tdgear.txt', expr: 'truck.damage.transmission * 100', decimals: 0 },
    { target: 'page4.tdcab.txt', expr: 'truck.damage.cabin * 100', decimals: 0 },
    { target: 'page4.tdchas.txt', expr: 'truck.damage.chassis * 100', decimals: 0 },
    { target: 'page5.tfromc.txt', expr: 'job.source.city.name' },
    { target: 'page5.ttoc.txt', expr: 'job.destination.city.name' },
    { target: 'page5.teta.txt', expr: "floor(navigation.time / 3600) + ':' + pad(floor(navigation.time % 3600 / 60), 2)" },
    { target: 'page5.tdue.txt', expr: "floor(x.deliveryMinutes / 60) + ':' + pad(x.deliveryMinutes % 60, 2)" },
  ],
};
{
  const { createNextion, normalizeNextion, parseTarget, directFrames } = await import('../pc/agent/studio/nextion.mjs');
  assert.deepEqual(parseTarget('page1.tgear.txt'), { page: 'page1', obj: 'tgear', attr: 'txt' });
  assert.equal(parseTarget('tgear.txt'), null);
  assert.equal(parseTarget('page1.t"x.txt'), null);

  const zero = (await import('node:module')).createRequire(import.meta.url);
  const req = zero('../pc/agent/node_modules/trucksim-telemetry/lib/converter/index.js');
  const parse = zero('../pc/agent/node_modules/trucksim-telemetry/lib/parser/parseData.js');
  const live = parse(req.converter(12, Buffer.alloc(32768)));
  live.truck.speed.kph = 87; live.truck.fuel.value = 200; live.truck.fuel.capacity = 400; live.truck.fuel.range = 812.6;
  live.truck.transmission.gear.displayed = 9; live.game.time.value = 8 * 60 + 5; live.trailer.attached = true;
  live.trailer.model.name = 'Curtainsider'; live.trailer.model.id = 'scs_box'; live.trailer.licensePlate.value = 'AB 123';
  live.truck.lights.blinker.left.enabled = true; live.truck.brakes.retarder.level = 2; live.truck.cruiseControl.enabled = true; live.truck.cruiseControl.kph = 84.2;
  live.job.source.city.name = 'Hamburg'; live.navigation.time = 5400 + 60; live.job.expectedDeliveryTimestamp.value = live.game.time.value + 125;

  const cfg = normalize({ serial: [], nextion: [{ ...NX, enabled: true, port: 'COM13' }] }).nextion[0];
  assert.equal(cfg.bindings.length, NX.bindings.length);
  const sent = [];
  // createNextion hands each batch of commands to out(); on a display with its own COM port they leave as FF FF FF framed bytes
  const nxOut = { out: cmdList => sent.push(directFrames(cmdList)) };
  const cmds = () => sent.splice(0).flatMap(b => b.toString('latin1').split('\xff\xff\xff').filter(Boolean));
  const nx = createNextion(cfg, nxOut);
  nx.state('open');
  assert.deepEqual(cmds(), ['bkcmd=0', 'sendxy=1']);
  // game closed + power off: the display sleeps, once
  nx.tick(null, 1000);
  nx.tick(null, 1040);
  assert.deepEqual(cmds(), ['sleep=1']);
  // game starts: wake, page1, then (after the page settles) page1's bindings only
  nx.tick(live, 2000);
  assert.deepEqual(cmds(), ['sleep=0', 'page page1']);
  nx.tick(live, 2100); // still settling
  assert.deepEqual(cmds(), []);
  nx.tick(live, 2400);
  const first = cmds();
  assert.ok(first.includes('tgear.txt="9"'), 'gear text');
  assert.ok(first.includes('tclock.txt="08:05"'), 'clock');
  assert.ok(first.includes('vis pblinkl,1') && first.includes('vis pblinkr,0'), 'blinkers');
  assert.ok(first.includes('vis pr2,1') && first.includes('vis pr3,0'), 'retarder steps');
  assert.ok(first.includes('j0.val=50'), 'fuel bar');
  assert.ok(first.includes('trange.txt="813"'), 'range rounded');
  assert.ok(first.includes('tcruise.txt="84"'), 'cruise');
  assert.ok(first.includes('tlimit.txt=""'), 'no speed limit -> empty');
  assert.ok(first.every(c => !/^(tair|tfromc|tname)/.test(c)), 'other pages are not sent');
  // unchanged -> nothing
  nx.tick(live, 2440);
  assert.deepEqual(cmds(), []);
  // a change is sent alone
  live.truck.transmission.gear.displayed = -1;
  nx.tick(live, 2480);
  assert.deepEqual(cmds(), ['tgear.txt="R"']);
  // touch: press in the right half of the bottom strip -> next page (67 xh xl yh yl state FF FF FF)
  const touch = (x, y) => Buffer.from([0x67, x >> 8, x & 255, y >> 8, y & 255, 1, 0xff, 0xff, 0xff]);
  nx.rx(touch(400, 245), 3000); // 83%, 90%
  nx.tick(live, 3010);
  assert.deepEqual(cmds(), ['page page3']);
  nx.rx(touch(400, 245), 3100); // debounced
  nx.tick(live, 3200);
  nx.tick(live, 3400);
  const p3 = cmds();
  assert.ok(p3.includes('tair.txt="0.0"') && p3.some(c => c.startsWith('jair.val=')), 'page3 bindings');
  nx.rx(touch(100, 245), 4000); // left half -> previous
  nx.tick(live, 4010);
  assert.deepEqual(cmds(), ['page page1']);
  nx.rx(touch(100, 10), 5000); // outside every hotspot: nothing
  nx.tick(live, 5010);
  assert.deepEqual(cmds().filter(c => c.startsWith('page ')), []);
  // a pop-up page (ignition off) wins over the rotation while its condition is true
  const popCfg = normalize({ serial: [], nextion: [{ ...cfg, pages: [{ name: 'page2', rotation: false, showWhen: '!truck.electric.enabled' }, ...cfg.pages] }] }).nextion[0];
  const nx2 = createNextion(popCfg, nxOut);
  nx2.state('open'); cmds();
  nx2.tick(live, 100);
  assert.ok(cmds().includes('page page2'));
  live.truck.electric.enabled = true;
  nx2.tick(live, 200);
  assert.ok(cmds().includes('page page1'));
  {
    const nx3 = createNextion({ ...cfg, powerOffWhenIdle: false }, nxOut);
    nx3.state('open'); cmds();
    nx3.tick(live, 1000); nx3.tick(live, 1400); cmds();
  // ...also minutes later: no periodic re-write (it makes the display flicker)
  for (let t = 40; t < 600000; t += 40) nx3.tick(live, 1400 + t);
  assert.deepEqual(cmds(), []);
  // the display announces a restart (88 FF FF FF): page and values are sent again
  nx3.rx(Buffer.from([0x88, 0xff, 0xff, 0xff]), 700000);
  assert.deepEqual(cmds(), ['bkcmd=0', 'sendxy=1']);
  nx3.tick(live, 700040);
  assert.deepEqual(cmds(), ['sleep=0', 'page page1']);
  nx3.tick(live, 700400);
  assert.ok(cmds().includes('tgear.txt="R"'), 'values resent after the restart');
  assert.equal(nx3.status().resets, 1);
  }
  // every binding of the test display compiles and evaluates on real-shaped data, with and without a game
  const st = nx.status();
  assert.equal(st.bindings.filter(b => b.error).length, 0, JSON.stringify(st.bindings.filter(b => b.error)));
  for (const page of ['page1', 'page3', 'page4', 'page5']) {
    const n = createNextion({ ...cfg, idlePage: page, powerOffWhenIdle: false }, nxOut);
    n.state('open'); cmds();
    n.tick(null, 10); n.tick(null, 400);
    const idleCmds = cmds();
    assert.ok(idleCmds.length > 3, `${page}: bindings sent while idle`);
    assert.ok(n.status().bindings.every(b => !b.error), `${page}: no errors with no game`);
  }
  // page 5 text formats
  const n5 = createNextion({ ...cfg, pages: [{ name: 'page5', rotation: true, showWhen: '' }], powerOffWhenIdle: false }, nxOut);
  n5.state('open'); cmds(); n5.tick(live, 10); n5.tick(live, 400);
  const c5 = cmds();
  assert.ok(c5.includes('teta.txt="1:31"') && c5.includes('tdue.txt="2:05"') && c5.includes('tfromc.txt="Hamburg"'), c5.join(' | '));
  assert.ok(createNextion(normalizeNextion([{ bindings: [{ target: 'bad', expr: '1' }] }], new Set())[0], nxOut).status().bindings[0].error);

  // transports: a display on its own COM port gets FF FF FF framed commands, one behind a pass-through board gets "@<command>" lines
  const { tunnelLines, tunnelFrame, rgb565 } = await import('../pc/agent/studio/nextion.mjs');
  assert.equal(directFrames(['a', 'b']).toString('latin1'), 'a\xff\xff\xffb\xff\xff\xff');
  assert.equal(tunnelLines(['page page1', 'bkcmd=0']).toString('latin1'), '@page page1\n@bkcmd=0\n');
  assert.deepEqual([...tunnelFrame('@88')], [0x88, 0xff, 0xff, 0xff]);
  assert.deepEqual([...tunnelFrame('@670190014001')], [0x67, 0x01, 0x90, 0x01, 0x40, 0x01, 0xff, 0xff, 0xff]); // a touch at 400,320
  assert.equal(tunnelFrame('hello'), null);
  assert.equal(tunnelFrame('@6'), null);
  assert.equal(rgb565('#0B1119'), 2179); // the Scania emblem's background
  assert.equal(rgb565('#00FF00'), 2016);
  assert.equal(rgb565('nonsense'), 65535);

  // widgets: Studio draws lamps, bars and text over the page picture (no components in the Nextion project)
  const wcfg = normalize({ serial: [], nextion: [{
    id: 'w', enabled: true, port: 'COM13', width: 272, height: 480, encoding: 'latin5', powerOffWhenIdle: false,
    pages: [{ name: 'pg1', rotation: true, showWhen: '', pic: 5, litPic: 6 }],
    widgets: [
      { page: 'pg1', k: 'lamp', id: 'low', x: 220, y: 300, w: 30, h: 40, expr: 'truck.lights.beamLow.enabled' },
      { page: 'pg1', k: 'bar', id: 'fuel', x: 0, y: 100, w: 100, h: 10, expr: 'x.fuelPercent', color: '#00FF00' },
      { page: 'pg1', k: 'text', id: 'name', x: 0, y: 0, w: 200, h: 30, font: 2, color: '#FFFFFF', align: 'c', expr: "'Işık İğ'" },
    ],
  }] }).nextion[0];
  assert.equal(wcfg.widgets.length, 3);
  assert.equal(wcfg.encoding, 'latin5');
  live.truck.lights.beamLow.enabled = true; // fuel is 200 of 400 = 50 %
  const wn = createNextion(wcfg, nxOut);
  wn.state('open'); cmds();
  wn.tick(live, 10); wn.tick(live, 400);
  const wc = cmds();
  assert.ok(wc.includes('xpic 220,300,30,40,220,300,6'), 'a lit lamp is cropped from the lit picture: ' + wc.join(' | '));
  assert.ok(wc.includes('fill 0,100,50,10,2016') && wc.includes('xpic 50,100,50,10,50,100,5'), 'a half bar: green fill, background for the rest');
  assert.ok(wc.includes('xstr 0,0,200,30,2,65535,5,1,1,0,"Iþýk Ýð"'), 'Turkish letters become ISO-8859-9 bytes');
  wn.tick(live, 440);
  assert.deepEqual(cmds(), [], 'unchanged widgets are not redrawn');
  live.truck.lights.beamLow.enabled = false;
  wn.tick(live, 480);
  assert.deepEqual(cmds(), ['xpic 220,300,30,40,220,300,5'], 'only the lamp that changed is drawn again');
  assert.deepEqual(wn.status().widgets.map(w => w.error), [null, null, null]);
}

// an edit of a Nextion display (its port stays open) re-initialises the display
{
  const w = [];
  const ev = new EventEmitter();
  const h = {
    events: ev, connected: true,
    open: (id) => { queueMicrotask(() => ev.emit('state', { id, state: 'open' })); return true; },
    close: () => {}, write: (id, data) => w.push([id, Buffer.from(data).toString('latin1')]),
    ports: async () => ({ ports: [] }), probe: async () => ({}),
  };
  const eng = createEngine({ hub: h, getRaw: () => null, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')) });
  const c = structuredClone(eng.config);
  c.nextion = [{ ...NX, enabled: true, port: 'COM13', powerOffWhenIdle: true }];
  eng.apply(c);
  await new Promise(r => setTimeout(r, 120));
  assert.ok(w.some(x => x[0] === 'nx:scania' && x[1].includes('bkcmd=0')), 'initialised on open');
  assert.equal(eng.status().nextion[0].state, 'open');
  w.length = 0;
  const c2 = structuredClone(eng.config);
  c2.nextion[0].powerOffWhenIdle = false; // edit: the runtime is rebuilt, the port is not reopened
  const rev0 = eng.rev;
  eng.apply(c2);
  assert.notEqual(eng.rev, rev0, 'every saved change gets a new revision (the page refuses to save over a newer one)');
  await new Promise(r => setTimeout(r, 160));
  assert.equal(eng.status().nextion[0].state, 'open', 'still open after an edit');
  assert.ok(w.some(x => x[1].includes('bkcmd=0')), 're-initialised after an edit');
  assert.ok(w.some(x => x[1].includes('page page1')), 'idle page shown');
}

// the power output (FAN0): field 7 of the data line, with an off delay
{
  const w = [];
  const ev = new EventEmitter();
  let raw = { truck: { electric: { enabled: true } } };
  const h = {
    events: ev, connected: true,
    open: id => { queueMicrotask(() => ev.emit('state', { id, state: 'open' })); return true; },
    close: () => {}, write: (id, data) => { if (id === 'oct') w.push(String(data)); },
    ports: async () => ({ ports: [] }), probe: async () => ({}),
  };
  const eng = createEngine({ hub: h, getRaw: () => raw, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')) });
  const c = structuredClone(eng.config);
  c.serial = [{ id: 'oct', name: 'Octopus', enabled: true, port: 'COM9', board: 'octopus', power: { enabled: true, expr: 'truck.electric.enabled', offDelay: 1 } }];
  eng.apply(c);
  assert.equal(eng.config.serial[0].power.offDelay, 1);
  // timers on a busy machine drift: wait for the state instead of for a fixed time
  const until = async (fn, what, ms = 3000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) assert.fail(`${what} (last line: ${JSON.stringify(w.at(-1))})`);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  const field7 = () => w.at(-1)?.trim().split(',')[6];
  await until(() => field7() === '1', 'ignition on -> seventh field 1');
  assert.equal(eng.status().devices[0].power.on, true);
  raw = { truck: { electric: { enabled: false } } };
  await until(() => eng.status().devices[0].power.want === false, 'the formula went false');
  assert.equal(field7(), '1', 'still on right after the formula went false (off delay)');
  await until(() => field7() === '0', 'off after the delay');
  assert.ok(eng.testPower('oct', 1000));
  await until(() => field7() === '1', 'test switches it on');
  // without the output the line keeps its six fields; a formula error never switches on
  const c2 = structuredClone(eng.config);
  c2.serial[0].power = { enabled: false, expr: 'truck.electric.enabled', offDelay: 60 };
  eng.apply(c2);
  await until(() => w.at(-1).trim().split(',').length === 6, 'six fields without the output');
  const c3 = structuredClone(eng.config);
  c3.serial[0].power = { enabled: true, expr: '1 +', offDelay: 60 };
  eng.apply(c3);
  await until(() => eng.status().devices[0].power?.error, 'the broken formula is reported');
  await until(() => field7() === '0', 'a broken formula keeps the output off', 4000); // after the test window ran out
}

// the manual power switch: on = the output stays on without the game, without the formula, without the "enabled" box
{
  const w = [];
  const ev = new EventEmitter();
  const h = {
    events: ev, connected: true,
    open: id => { queueMicrotask(() => ev.emit('state', { id, state: 'open' })); return true; },
    close: () => {}, write: (id, data) => { if (id === 'oct') w.push(String(data)); },
    ports: async () => ({ ports: [] }), probe: async () => ({}),
  };
  const eng = createEngine({ hub: h, getRaw: () => null, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')) });
  const c = structuredClone(eng.config);
  c.serial = [{ id: 'oct', name: 'Octopus', enabled: true, port: 'COM9', board: 'octopus', idle: 'none', power: { enabled: false, manual: true } }];
  eng.apply(c);
  assert.equal(eng.config.serial[0].power.manual, true);
  const until = async (fn, what, ms = 3000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) assert.fail(`${what} (last line: ${JSON.stringify(w.at(-1))})`);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  const field7 = () => w.at(-1)?.trim().split(',')[6];
  await until(() => field7() === '1', 'manual on: seventh field 1 even with no game and idle=none');
  assert.equal(eng.status().devices[0].power.manual, true);
  const n = w.length;
  await until(() => w.length > n + 2, 'the line is repeated (keep-alive) so the board does not time out');
  const c2 = structuredClone(eng.config);
  c2.serial[0].power.manual = false;
  eng.apply(c2);
  await until(() => w.at(-1)?.trim().split(',').length !== 7 || field7() === '0', 'manual off: output off again');
}

// motors sleep without a game: no data lines at all (the board's drivers run dry), CFG IDLE goes to the board, a game wakes them
{
  assert.deepEqual(normalizeSleep({}), { motors: false, motorsDelay: 60, leds: false });
  assert.equal(normalizeSleep({ motorsDelay: 9999 }).motorsDelay, 255);
  assert.equal(normalizeSleep({ motorsDelay: 1 }).motorsDelay, 5);
  assert.equal(idleCommand(normalizeSleep({ motors: true, motorsDelay: 90 })), 'CFG IDLE off=1 sec=90');
  assert.equal(hasIdle('1.4'), false);
  assert.equal(hasIdle('1.5'), true);
  assert.equal(parseCfg(['CFG IDLE off=1 sec=60']).idle.off, true);
  assert.equal(parseHello('OCTOPUS-GAUGES 1.5 motors=6 cfg=1 power=1 leds=24 idle=1').idle, true);

  const w = [];
  const ev = new EventEmitter();
  let raw = null;
  const h = {
    events: ev, connected: true,
    open: id => { queueMicrotask(() => ev.emit('state', { id, state: 'open' })); return true; },
    close: () => {}, write: (id, data) => { if (id === 'oct') w.push(String(data)); },
    ports: async () => ({ ports: [] }), probe: async () => ({}),
  };
  const eng = createEngine({ hub: h, getRaw: () => raw, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')) });
  const c = structuredClone(eng.config);
  c.serial = [{ id: 'oct', name: 'Octopus', enabled: true, port: 'COM9', board: 'octopus', idle: 'zeros', sleep: { motors: true, motorsDelay: 30 }, power: { manual: true } }];
  eng.apply(c);
  const until = async (fn, what, ms = 3000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) assert.fail(`${what} (lines: ${JSON.stringify(w.slice(-4))})`);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  await until(() => w.includes('CFG IDLE off=1 sec=30\n'), 'the board is told that its motors may sleep');
  await until(() => w.includes('W1\n'), 'asleep: only the short power command goes out (power switch is on)');
  await new Promise(r => setTimeout(r, 400));
  assert.ok(!w.some(x => /^\d/.test(x)), 'asleep: no data line, so no current in the motors');
  assert.equal(eng.status().devices[0].asleep, true);
  raw = { truck: { electric: { enabled: true }, engine: { rpm: { value: 1000 } } } };
  await until(() => w.some(x => /^\d+,\d+,\d+,\d+,\d+,\d+,1\n$/.test(x)), 'a game: data lines with the power field go out, the board wakes the motors');
  assert.equal(eng.status().devices[0].asleep, false);
  raw = null;
  const n = w.length;
  await until(() => eng.status().devices[0].asleep === true, 'game over: asleep again');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!w.slice(n).some(x => /^\d/.test(x)), 'no data line after the game ended');
}

// the LED chain: configuration, the board's static copy, the renderer (effects, bars, rules, correction), frames to the board
{
  const l = normalizeLeds({});
  assert.equal(l.count, 24);
  assert.equal(l.order, 2);
  assert.deepEqual(l.segments.map(s => [s.start, s.len]), [[0, 6], [6, 6], [12, 3], [15, 3], [18, 3], [21, 3]]);
  assert.equal(l.enabled, false);
  assert.equal(l.gamma, 1);
  const odd = normalizeLeds({ count: 10, order: 9, bri: -5, segments: [{ start: 8, len: 50, color: 'red', on: false }, { start: 99, len: 1 }] });
  assert.equal(odd.order, 5, 'an order past the last one is clamped');
  assert.equal(odd.bri, 0);
  assert.equal(odd.segments[0].start, 8);
  assert.equal(odd.segments[0].len, 2);
  assert.equal(odd.segments[0].on, false);
  assert.equal(odd.segments[0].look.c1, '#ff9329', 'a bad colour becomes the default');
  assert.equal(odd.segments[1].start, 9, 'a start past the end is pulled in');
  assert.equal(normalizeLeds({ count: 6, segments: [{ start: 0, len: 6, color: '#0A0B0C' }] }).segments[0].look.c1, '#0a0b0c', 'an old segment with just a colour is a solid look');
  assert.equal(ledCommand(normalizeLeds({ count: 6, segments: [{ start: 0, len: 6, color: '#0a0b0c' }] })), 'LED n=6 order=2 bri=255 seg=0,6,10,11,12,1');
  assert.equal(ledCommand(normalizeLeds({ count: 6, segments: [] })), 'LED n=6 order=2 bri=255 clear');
  assert.equal(ledCommand(normalizeLeds({ count: 6, maxBri: 100, segments: [] })), 'LED n=6 order=2 bri=100 clear', 'the cap shows in the static copy');
  assert.equal(ledCommand(normalizeLeds({ count: 6, segments: [] }), { dark: true }), 'LED n=6 order=2 bri=0 clear');
  assert.deepEqual(parseCfg(['CFG LED n=24 order=2 bri=255 segs=1', 'CFG SEG 0 start=0 len=24 r=1 g=2 b=3 on=1', 'CFG END motors=6 saved=1']).led,
    { count: 24, order: 2, bri: 255, segs: [{ start: 0, len: 24, r: 1, g: 2, b: 3, on: true }] });
  assert.equal(hasLedFrames('1.4'), false);
  assert.equal(hasLedFrames('1.5'), true);

  // the renderer
  const solid = (extra = {}, seg = {}) => normalizeLeds({ enabled: true, count: 6, segments: [{ start: 0, len: 6, look: { fx: 'solid', c1: '#ff0000' }, ...seg }], ...extra });
  const none = () => 0;
  const px = (u8, i) => [...u8.slice(i * 3, i * 3 + 3)];
  const R = createRenderer();
  const f1 = R.render(solid(), 1000, none);
  assert.equal(f1.length, 18);
  assert.deepEqual(px(f1, 0), [255, 0, 0]);
  assert.deepEqual(px(f1, 5), [255, 0, 0]);
  assert.deepEqual(px(createRenderer().render(solid({ bri: 128 }), 1000, none), 0), [128, 0, 0], 'master brightness');
  assert.deepEqual(px(createRenderer().render(solid({ bri: 255, maxBri: 64 }), 1000, none), 0), [64, 0, 0], 'the brightness cap');
  assert.deepEqual(px(createRenderer().render(solid({ gamma: 2 }, { look: { fx: 'solid', c1: '#808080' } }), 1000, none), 0), [64, 64, 64], 'gamma 2');
  assert.deepEqual(px(createRenderer().render(solid({ rgb: [100, 50, 100] }, { look: { fx: 'solid', c1: '#ffffff' } }), 1000, none), 0), [255, 128, 255], 'channel scale');
  assert.deepEqual(px(createRenderer().render(solid({ sat: 0 }, { look: { fx: 'solid', c1: '#ff0000' } }), 1000, none), 0), [76, 76, 76], 'no saturation = grey');
  const warm = px(createRenderer().render(solid({ temp: 100 }, { look: { fx: 'solid', c1: '#ffffff' } }), 1000, none), 0);
  assert.ok(warm[0] === 255 && warm[2] < warm[1] && warm[1] < 255, 'warm white balance');
  assert.deepEqual([...createRenderer().render(solid(), 1000, none, { awake: false })], new Array(18).fill(0), 'dark when asleep');
  assert.deepEqual(px(createRenderer().render(solid({}, { on: false }), 1000, none), 0), [0, 0, 0], 'a segment that is off');
  assert.deepEqual(px(createRenderer().render(solid({}, { bri: 128, opacity: 100 }), 1000, none), 0), [128, 0, 0], 'segment brightness');
  const sm = createRenderer();
  sm.render(solid({ smooth: 500 }), 1000, none, { awake: false });
  const faded = px(sm.render(solid({ smooth: 500 }), 1040, none), 0);
  assert.ok(faded[0] > 0 && faded[0] < 255, `smoothing crossfades (${faded})`);

  // every effect renders 24 pixels for a while without trouble
  for (const e of EFFECTS) {
    const cfg = normalizeLeds({ enabled: true, count: 24, segments: [{ start: 0, len: 24, look: { fx: e.id, pal: e.pal ? 'rainbow' : 'colors', c1: '#ff2000', c2: '#0020ff', c3: '#00ff00' } }] });
    const r = createRenderer();
    let lit = 0;
    for (let k = 0; k < 120; k++) {
      const f = r.render(cfg, 5000 + k * 40, none);
      assert.equal(f.length, 72, e.id);
      lit += f.reduce((a, b) => a + b, 0);
    }
    assert.ok(lit > 0, `${e.id} shows something`);
  }
  assert.ok(EFFECTS.length >= 28, 'a WLED-sized effect list');

  // reverse, mirror, grouping and spacing
  const grad = (seg, n = 4) => normalizeLeds({ enabled: true, count: n, segments: [{ start: 0, len: n, look: { fx: 'gradient', pal: 'colors', c1: '#ff0000', c2: '#0000ff', c3: '#0000ff' }, ...seg }] });
  const g0 = createRenderer().render(grad({}), 0, none);
  assert.deepEqual(px(g0, 0), [255, 0, 0]);
  assert.deepEqual(px(g0, 3), [0, 0, 255]);
  const g1 = createRenderer().render(grad({ reverse: true }), 0, none);
  assert.deepEqual(px(g1, 0), [0, 0, 255], 'reverse');
  const g2 = createRenderer().render(grad({ mirror: true }), 0, none);
  assert.deepEqual(px(g2, 0), px(g2, 3), 'mirror');
  assert.deepEqual(px(g2, 1), px(g2, 2), 'mirror');
  const gs = createRenderer().render(normalizeLeds({ enabled: true, count: 6, segments: [{ start: 0, len: 6, group: 2, spacing: 1, look: { fx: 'solid', c1: '#ffffff' } }] }), 0, none);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => px(gs, i)[0]), [255, 255, 0, 255, 255, 0], 'groups of 2 with a gap of 1');

  // a game value as a bar, and rules that take over
  const bar = (v, extra = {}) => normalizeLeds({ enabled: true, count: 6, segments: [{ start: 0, len: 6, mode: 'bar', bar: { value: 'x.v', lo: 0, hi: 100, stops: [[0, '#00ff00'], [1, '#ff0000']], bg: '#000000', ...extra } }] });
  const b50 = createRenderer().render(bar(50), 0, p => (p === 'x.v' ? 50 : 0));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => px(b50, i).some(Boolean)), [true, true, true, false, false, false], 'half a bar');
  const b100 = createRenderer().render(bar(100), 0, p => (p === 'x.v' ? 100 : 0));
  assert.ok([0, 1, 2, 3, 4, 5].every(i => px(b100, i).some(Boolean)), 'a full bar');
  assert.ok(px(b100, 5)[0] > px(b100, 5)[1] && px(b100, 0)[1] > px(b100, 0)[0], 'green at the start, red at the end');
  const ruled = solid({}, { rules: [{ name: 'blue when set', when: 'x.b', look: { fx: 'solid', c1: '#0000ff' } }] });
  assert.deepEqual(px(createRenderer().render(ruled, 0, p => (p === 'x.b' ? 1 : 0)), 0), [0, 0, 255], 'a rule takes over');
  assert.deepEqual(px(createRenderer().render(ruled, 0, p => 0), 0), [255, 0, 0], 'no rule: the base look');
  const broken = createRenderer();
  broken.render(solid({}, { rules: [{ when: '1 +', look: {} }] }), 0, none);
  assert.ok(broken.errors.length === 1, 'a formula that does not compile is reported');

  // the engine sends frames to the board
  const w = [];
  const ev = new EventEmitter();
  let raw = null;
  const h = {
    events: ev, connected: true,
    open: id => { queueMicrotask(() => ev.emit('state', { id, state: 'open' })); return true; },
    close: () => {}, write: (id, data) => { if (id === 'oct') w.push(String(data)); },
    ports: async () => ({ ports: [] }), probe: async () => ({}),
  };
  const eng = createEngine({ hub: h, getRaw: () => raw, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')) });
  const until = async (fn, what, ms = 3000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) assert.fail(`${what} (last: ${JSON.stringify(w.slice(-3))})`);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  const frames = () => w.filter(x => x.startsWith('LEDF '));
  const c = structuredClone(eng.config);
  c.serial = [{ id: 'oct', name: 'Octopus', enabled: true, port: 'COM9', board: 'octopus', idle: 'none', leds: { enabled: false } }];
  eng.apply(c);
  await new Promise(r => setTimeout(r, 200));
  assert.ok(!w.some(x => x.startsWith('LED')), 'LEDs not enabled: the board keeps its own');
  eng.ledWatchers = 1;
  await until(() => eng.ledFrames().oct, 'a watching editor gets frames even with the LEDs disabled');
  assert.equal(frames().length, 0, '...but nothing goes to the board');
  eng.ledWatchers = 0;
  const c2 = structuredClone(eng.config);
  c2.serial[0].leds.enabled = true;
  eng.apply(c2);
  assert.ok(w.at(-1).startsWith('LED n=24 order=2 bri=255 seg=0,6,255,147,41,1 seg=6,6'), `enabling pushes the static copy (${w.at(-1)})`);
  await until(() => frames().length > 0, 'sleep is off: frames go out even without a game');
  raw = { truck: { electric: { enabled: true } } };
  await until(() => frames().at(-1) === `LEDF ${'ff9329'.repeat(24)}\n`, 'the segments default to warm white');
  raw = null;
  const c3 = structuredClone(eng.config);
  c3.serial[0].sleep = { leds: true };
  eng.apply(c3);
  assert.ok(w.filter(x => x.startsWith('LED n=')).at(-1).includes('bri=0'), 'sleep: the static copy is dark too');
  await until(() => frames().at(-1) === `LEDF ${'00'.repeat(72)}\n`, 'sleeping LEDs: black frames keep coming');
  assert.equal(eng.ledTest('oct', 60), true);
  await until(() => frames().at(-1) === `LEDF ${'ff9329'.repeat(24)}\n`, 'a test lights the LEDs without a game');
  assert.equal(eng.ledTest('oct', 0), true);
  await until(() => frames().at(-1) === `LEDF ${'00'.repeat(72)}\n`, 'the test ended');
  assert.equal(eng.ledLive('oct', { count: 2, segments: [{ start: 0, len: 2, look: { fx: 'solid', c1: '#ffffff' } }] }), true);
  await until(() => frames().at(-1) === `LEDF ${'ffffff'.repeat(2)}\n`, 'live colours reach the strip at once (and wake it)');
  assert.equal(eng.ledLive('nope', {}), false);
}

// the zero offset after homing (firmware 1.3 "hoff", degrees in Studio, 0.1 deg on the wire)
{
  assert.equal(normalizeMotor({}).hoff, 0.5);
  assert.equal(normalizeMotor({ hoff: 5 }).hoff, 5);
  assert.equal(normalizeMotor({ hoff: 999 }).hoff, 180);
  assert.equal(normalizeMotor({ hoff: -3 }).hoff, 0);
  assert.ok(motorCommand(3, normalizeMotor({ hoff: 4.5 })).endsWith(' hoff=45 smooth=15'));
  assert.ok(!motorCommand(3, normalizeMotor({ hoff: 4.5 }), '1.2').includes('hoff'), 'an older firmware gets no hoff');
  assert.ok(motorCommand(3, normalizeMotor({}), '1.3').endsWith(' hoff=5'), '1.3 knows hoff but not smooth');
  assert.equal(normalizeMotor({ smooth: 0 }).smooth, 0);
  assert.equal(normalizeMotor({ smooth: 500 }).smooth, 100);
  assert.equal(normalizeMotor({}).smooth, 15);
  assert.equal(hasHomeOffset('1.3'), true);
  assert.equal(hasHomeOffset('1.2'), false);
  assert.equal(hasHomeOffset('2.0'), true);
  const line = 'CFG M3 en=1 dir=1 ms=16 ma=500 hold=30 home=1 spr=200 sweep=2400 full=1200 vmax=500 acc=5000 sg=40 hoff=50';
  assert.equal(parseCfg([line]).motors[3].hoff, 5);
  const old = parseCfg([line.replace(' hoff=50', '')]).motors[3];
  assert.equal(old.noHoff, true);
  const wanted = parseCfg([line]).motors[3];
  assert.deepEqual(motorDiff([{ ...wanted, hoff: 7 }], [old]), [], 'a firmware without hoff is not reported as different for it');
  assert.deepEqual(motorDiff([{ ...wanted, hoff: 4 }], [wanted]), [0]);
}

console.log('studio: all tests passed');
process.exit(0);
