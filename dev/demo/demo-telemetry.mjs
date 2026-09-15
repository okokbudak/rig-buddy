// Writes demo telemetry frames in the scs-sdk-plugin v12 shared-memory layout
// (what the game's telemetry plugin provides), for screenshots without the
// game: a Scania on the A24 from Berlin to Hamburg with an electronics job.
// The truck follows the positions of data/sim/berlin-hamburg.ndjson.gz (from
// dev-run-sim.ps1). run-demo.ps1 plays the frames into Local\SCSTelemetry.
//
// usage: node dev/demo/demo-telemetry.mjs <out.bin> [start fraction 0..1, default 0.55]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
const [out = path.join(root, 'local/demo/telemetry.bin'), startArg = '0.55'] = process.argv.slice(2);
const require = createRequire(path.join(root, 'vendor/tm-maps/package.json'));
const layout = require('trucksim-telemetry/lib/converter/scs_sdk_plugin_12.js');
const off = name => {
  const f = layout.fields[name];
  if (!f) throw new Error(`no field ${name}`);
  return typeof f.offset === 'number' ? f.offset : f.offset.bytes;
};
// inside trailers[0] (not exposed by struct-fu; found by probing the layout)
const TRAILER0 = { attached: 6080, modelName: 7240 };

const recording = zlib.gunzipSync(fs.readFileSync(path.join(root, 'data/sim/berlin-hamburg.ndjson.gz')))
  .toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
const points = recording.slice(Math.floor(recording.length * Number(startArg))).filter(r => r.truck?.position);

const game = JSON.parse(fs.readFileSync(path.join(root, 'data/game/europe-companies.json'), 'utf8'));
const inHamburg = new Set(game.filter(c => c.cityToken === 'hamburg').map(c => c.token));
const destination = ['tradeaux', 'posped', 'kaarfor', 'ns_oil'].find(t => inHamburg.has(t)) ?? 'ns_oil';
const names = { tradeaux: 'Tradeaux', posped: 'Posped', kaarfor: 'Kaarfor', ns_oil: 'NS Oil' };

const GAME_MINUTE = 2 * 1440 + 14 * 60 + 25; // Wednesday 14:25
const frames = points.map((r, i) => {
  const b = Buffer.alloc(layout.size);
  const u8 = (n, v) => b.writeUInt8(v ? 1 : 0, off(n));
  const u32 = (n, v, extra = 0) => b.writeUInt32LE(v, off(n) + extra);
  const f32 = (n, v) => b.writeFloatLE(v, off(n));
  const str = (n, v) => b.write(v, off(n), 63, 'utf8');
  const kph = r.truck.speed?.kph ?? 85;

  u8('game.sdkActive', true);
  u8('game.paused', false);
  b.writeBigUInt64LE(BigInt(1_000_000_000 + i * 500_000), off('game.timestamp.value'));
  u32('game.pluginVersion', 12);
  u32('game.version', 1); u32('game.version', 53, 4);
  u32('game.game', 1); // ets2
  u32('game.telemetryVersion', 1); u32('game.telemetryVersion', 18, 4);
  u32('game.time', GAME_MINUTE + Math.floor(i / 120));
  u32('game.maxTrailerCount', 10);
  f32('game.scale', 19);

  str('truck.make.id', 'scania'); str('truck.make.name', 'Scania');
  str('truck.model.id', 'scania.s_2016'); str('truck.model.name', 'S');
  str('truck.licensePlate.value', 'RB 2026'); str('truck.licensePlate.country.id', 'germany');
  str('truck.licensePlate.country.name', 'Germany');
  f32('truck.speed', kph / 3.6);
  f32('truck.cruiseControl', 85 / 3.6); u8('truck.cruiseControl.enabled', true);
  f32('truck.engine.rpm.value', 1180 + (kph - 80) * 12); f32('truck.engine.rpm.max', 2500);
  u32('truck.transmission.forwardGears', 12);
  b.writeInt32LE(12, off('truck.transmission.gear.displayed'));
  b.writeInt32LE(12, off('truck.transmission.gear.selected'));
  u8('truck.engine.enabled', true); u8('truck.electric.enabled', true);
  f32('truck.fuel.capacity', 1200); f32('truck.fuel.value', 742 - i * 0.02);
  f32('truck.fuel.avgConsumption', 0.312); f32('truck.fuel.range', 2380); f32('truck.fuel.warning.factor', 0.15);
  f32('truck.adBlue.capacity', 80); f32('truck.adBlue.value', 51);
  f32('truck.engine.oilPressure.value', 62); f32('truck.engine.oilTemperature.value', 96);
  f32('truck.engine.waterTemperature.value', 88); f32('truck.engine.batteryVoltage.value', 27.8);
  f32('truck.brakes.airPressure.value', 128);
  f32('truck.odometer', 184230 + i * 0.012);
  b.writeDoubleLE(r.truck.position.X, off('truck.position'));
  b.writeDoubleLE(r.truck.position.Y ?? 0, off('truck.position') + 8);
  b.writeDoubleLE(r.truck.position.Z, off('truck.position') + 16);
  b.writeDoubleLE(r.truck.orientation?.heading ?? 0, off('truck.orientation'));

  b.writeUInt8(1, TRAILER0.attached);
  b.write('Krone Box Liner', TRAILER0.modelName, 63, 'utf8');

  str('job.cargo.id', 'electronics'); str('job.cargo.name', 'Electronics');
  f32('job.cargo.mass', 17380); u8('job.cargo.isLoaded', true); f32('job.cargo.damage', 0.004);
  u32('trailer.cargo.units', 70);
  str('job.source.city.id', 'berlin'); str('job.source.city.name', 'Berlin');
  str('job.source.company.id', 'dfh'); str('job.source.company.name', 'Deutsche Frachthäfen');
  str('job.destination.city.id', 'hamburg'); str('job.destination.city.name', 'Hamburg');
  str('job.destination.company.id', destination); str('job.destination.company.name', names[destination]);
  b.write('freight_market', off('job.market'), 31, 'utf8');
  b.writeUInt32LE(14230, off('job.income'));
  u32('job.plannedDistance', 289);
  u32('job.expectedDeliveryTimestamp', GAME_MINUTE + 380);

  const left = Math.max(0, 1 - i / points.length);
  f32('navigation.distance', 118_000 * left);
  f32('navigation.time', 5200 * left);
  f32('navigation.speedLimit', 25); // m/s, 90 km/h
  b.writeInt32LE(312, off('navigation.nextRestStop'));
  return b;
});

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat(frames));
console.log(`${frames.length} frames x ${layout.size} bytes -> ${out} (destination ${destination}.hamburg)`);
