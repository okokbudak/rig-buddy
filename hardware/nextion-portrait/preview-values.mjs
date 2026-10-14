// Fills every widget of studio-display.json with sample game values (through Studio's own formula
// engine) so render.ps1 can draw previews of the finished pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Rig Buddy sits next to Simdash under "Ai Projects"
import { compile } from '../../pc/agent/studio/expr.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const st = JSON.parse(fs.readFileSync(path.join(here, 'studio-display.json'), 'utf8'));
const vals = {
  'x.gameClock': '14:32', 'game.time.value': 1440 * 2 + 872, 'truck.speed.kph': 86.3, 'x.gearText': '12', 'navigation.speedLimit.kph': 90,
  'truck.cruiseControl.enabled': true, 'truck.cruiseControl.kph': 85, 'navigation.distance': 248000, 'navigation.time': 11100, 'truck.fuel.range': 910,
  'truck.lights.blinker.left.active': true, 'truck.brakes.retarder.level': 2, 'truck.lights.beamLow.enabled': true,
  'job.destination.city.name': 'Ankara', 'job.destination.company.name': 'Tree-Et Lojistik', 'job.source.city.name': 'İstanbul', 'job.source.company.name': 'Posped',
  'job.plannedDistance.km': 450, 'x.deliveryMinutes': 400, 'navigation.nextRestStop': 135, 'job.income': 12480, 'job.cargo.name': 'Elektronik', 'job.cargo.mass': 18000,
  'trailer.attached': true, 'trailer.brand.name': 'Krone', 'trailer.licensePlate.value': '34 TR 4512',
  'x.fuelPercent': 56, 'x.adBluePercent': 89, 'x.airBar': 8.4, 'x.psiToBar': 0.0689476, 'truck.engine.waterTemperature.value': 86, 'truck.engine.oilTemperature.value': 92,
  'truck.engine.oilPressure.value': 59.5, 'truck.engine.batteryVoltage.value': 27.6, 'truck.brakes.temperature.value': 372,
  'truck.damage.engine': 0.03, 'truck.damage.transmission': 0.02, 'truck.damage.cabin': 0.15, 'truck.damage.chassis': 0.05, 'truck.damage.wheels': 0.07,
  'trailer.damage.chassis': 0.01, 'trailer.damage.wheels': 0.04, 'trailer.body.damage': 0.01, 'trailer.damage.cargo': 0, 'truck.odometer': 128430,
  'truck.brakes.airPressure.emergency.enabled': true,
};
const get = p => vals[p];
const out = st.widgets.map(w => {
  const ev = e => (e && !String(e).startsWith('#') ? compile(e)(get) : e);
  const shown = w.show ? !!ev(w.show) : true;
  let v = ev(w.expr);
  if (typeof v === 'number' && w.k === 'text') v = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  return { page: w.page, id: w.id, k: w.k, value: w.k === 'text' ? (shown ? String(v ?? '') : '') : w.k === 'lamp' ? !!v : Math.max(0, Math.min(100, Number(v) || 0)), color: ev(w.color) ?? null };
});
fs.writeFileSync(path.join(here, 'preview-values.json'), JSON.stringify(out, null, 2));
console.log(`preview values for ${out.length} widgets`);
