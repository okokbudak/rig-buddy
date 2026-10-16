// Studio on its own for looking at the pages: a fake Octopus board, fake telemetry (rpm sweeping, indicators flashing),
// no serial port and no game. Usage: node dev/studio-demo.mjs   then open http://127.0.0.1:62898/#leds
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../pc/agent/studio/engine.mjs';
import { startStudio } from '../pc/agent/studio/server.mjs';

const PORT = Number(process.env.PORT || 62898);
const events = new EventEmitter();
const sent = [];
const hub = {
  events, connected: true,
  open: id => { queueMicrotask(() => events.emit('state', { id, state: 'open' })); return true; },
  close: () => {},
  write: (id, data) => { sent.push(String(data).slice(0, 60)); if (sent.length > 20) sent.shift(); },
  ports: async () => ({ ports: [{ port: 'COM20', name: 'USB Serial Device (COM20)' }] }),
  probe: async () => ({}),
};

let game = true;
const getRaw = () => {
  if (!game) return null;
  const t = Date.now() / 1000;
  const blink = Math.sin(t * 5) > 0;
  const rpm = 600 + 1900 * (0.5 + 0.5 * Math.sin(t * 0.8));
  return {
    truck: {
      position: { X: 1, Z: 1 }, electric: { enabled: true }, engine: { enabled: true, rpm: { value: rpm, max: 2500 } },
      speed: { kph: 60 + 40 * Math.sin(t * 0.3) },
      fuel: { value: 200, capacity: 700, warning: { enabled: false } },
      lights: { blinker: { left: { active: Math.sin(t * 0.4) > 0.3 && blink }, right: { active: false } }, brake: { enabled: Math.sin(t * 0.7) > 0.8 }, beamHigh: { enabled: false }, hazard: { enabled: false }, reverse: { enabled: false } },
      brakes: { parking: { enabled: false } },
    },
  };
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-demo-'));
const engine = createEngine({ hub, getRaw, dataDir: dir });
const cfg = structuredClone(engine.config);
cfg.serial = [{
  id: 'dash', name: 'Dashboard', enabled: true, port: 'COM20', board: 'octopus',
  leds: { enabled: true, count: 24, order: 2, segments: [
    { name: 'RPM', start: 0, len: 12, mode: 'bar', bar: { value: 'x.rpmPercent', lo: 0, hi: 100, stops: [[0, '#00c000'], [0.7, '#ffd000'], [0.9, '#ff2000']], peak: true, blinkAbove: 94 } },
    { name: 'Sol sinyal', start: 12, len: 6, look: { fx: 'solid', c1: '#000000' }, reverse: true, rules: [{ name: 'sol', when: 'truck.lights.blinker.left.active', look: { fx: 'wipe', c1: '#ff8000', c2: '#000000', speed: 200 } }] },
    { name: 'Ambiyans', start: 18, len: 6, look: { fx: 'fire', pal: 'fire' } },
  ] },
}];
engine.apply(cfg);
startStudio({ engine, hub, port: PORT });
console.log(`demo Studio: http://127.0.0.1:${PORT}/  (data in ${dir})`);
process.on('SIGUSR2', () => { game = !game; console.log('game', game); });
