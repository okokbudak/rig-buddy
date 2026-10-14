// Scania portrait cluster, 272 x 480 Nextion (4.3" turned 90 degrees).
// ONE source for both halves of the screen:
//   - `bg` / `lit`: what render.ps1 draws into the page pictures (static labels, tracks, dim icons;
//     `lit` = the same page with every lamp lit, cropped in by Studio when a lamp is on)
//   - `widgets`: what Rig Buddy Studio draws at run time with xstr / xpic / fill
// `node layout.mjs` writes layout.json (for render.ps1) and studio-display.json (for Studio).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 272, H = 480;
const C = {
  bg: '#0B1119',          // = the Scania emblem's background, so the logo blends in
  label: '#8A96A3', text: '#FFFFFF', soft: '#CFD6DF', track: '#232A33', line: '#1C232C',
  green: '#3FD17A', blue: '#5AA9FF', amber: '#F2A83B', red: '#FF5A4E', scania: '#D6262B', dark: '#3A414B',
};
// fonts the Nextion project must contain, in this order (Nextion Editor > Tools > Font Generator, ISO-8859-9)
const FONTS = [
  { id: 0, name: 'Arial', px: 16, bold: false, use: 'clock, small values' },
  { id: 1, name: 'Arial', px: 24, bold: false, use: 'values' },
  { id: 2, name: 'Arial', px: 24, bold: true, use: 'cruise, speed limit, warning title' },
  { id: 3, name: 'Arial', px: 32, bold: true, use: 'destination city, clock while off' },
  { id: 4, name: 'Arial', px: 112, bold: true, use: 'speed (digits are enough)' },
];

// --- expressions (Studio formulas) ---------------------------------------------------------------
const day = 'floor(game.time.value / 1440) % 7';
const WEEKDAY = `${day} == 0 ? 'Pzt' : ${day} == 1 ? 'Sal' : ${day} == 2 ? 'Çar' : ${day} == 3 ? 'Per' : ${day} == 4 ? 'Cum' : ${day} == 5 ? 'Cmt' : 'Paz'`;
const SPEED = 'round(abs(truck.speed.kph), 0)';
const hm = s => `floor(${s} / 60) + ':' + pad(floor(${s} % 60), 2)`;           // minutes -> h:mm
const hmSec = s => `floor(${s} / 3600) + ':' + pad(floor(${s} % 3600 / 60), 2)`; // seconds -> h:mm
const HAS_JOB = "job.destination.city.name != ''";
const pct = (v, max) => `min(100, max(0, (${v}) / ${max} * 100))`;
const sev = v => `(${v}) >= 30 ? '${C.red}' : (${v}) >= 10 ? '${C.amber}' : '${C.green}'`;

// --- shared pieces -------------------------------------------------------------------------------
const header = (center) => [
  { k: 'text', id: 'clock', x: 12, y: 6, w: 90, h: 22, font: 0, color: C.soft, align: 'l', expr: 'x.gameClock' },
  { k: 'text', id: 'day', x: 170, y: 6, w: 90, h: 22, font: 0, color: C.soft, align: 'r', expr: WEEKDAY },
  ...(center ? [{ k: 'text', id: 'gearspeed', x: 86, y: 6, w: 100, h: 22, font: 0, color: C.text, align: 'c', expr: `x.gearText + ' · ' + ${SPEED}` }] : []),
];
const dots = n => [0, 1, 2, 3].map(i => ({ t: 'circle', cx: 118 + i * 12, cy: 468, r: 3, c: i === n ? C.text : C.dark, fill: true }));
const label = (text, y, x = 20) => ({ t: 'text', x, y, s: 12, c: C.label, text });
const divider = y => ({ t: 'line', x1: 18, y1: y, x2: 254, y2: y, c: C.line, wd: 1 });

// the six warning lamps of the drive page: [icon, lit colour, formula]
const LAMPS = [
  ['park', C.red, 'truck.brakes.parking.enabled'],
  ['battery', C.red, 'truck.engine.batteryVoltage.warning.enabled'],
  ['air', C.red, 'truck.brakes.airPressure.warning.enabled || truck.brakes.airPressure.emergency.enabled'],
  ['fuel', C.amber, 'truck.fuel.warning.enabled'],
  ['lowbeam', C.green, 'truck.lights.beamLow.enabled'],
  ['highbeam', C.blue, 'truck.lights.beamHigh.enabled'],
];
const lampX = i => 24 + i * 40;

// --- pages ---------------------------------------------------------------------------------------
const pages = [];

pages.push({
  name: 'page0', title: 'Logo (kontak açık, motor kapalı)',
  showWhen: 'truck.electric.enabled && !truck.engine.enabled',
  bg: [
    { t: 'image', file: 'assets/logo.png', x: 68, y: 165 },
    { t: 'text', x: 0, y: 418, w: W, s: 13, c: C.label, a: 'c', text: 'Motoru çalıştır' },
  ],
  widgets: [],
});

pages.push({
  name: 'page1', title: 'Sürüş', rotation: true,
  bg: [
    { t: 'poly', pts: [[16, 52], [36, 40], [36, 64]], c: C.track },
    { t: 'poly', pts: [[256, 52], [236, 40], [236, 64]], c: C.track },
    { t: 'text', x: 0, y: 176, w: W, s: 15, c: C.label, a: 'c', text: 'km/h' },
    divider(272),
    label('HIZ SABİTLEYİCİ', 292), label('RETARDER', 322),
    ...[0, 1, 2, 3].map(i => ({ t: 'rect', x: 166 + i * 22, y: 322, w: 18, h: 13, r: 2, c: C.track })),
    divider(350),
    label('HEDEFE', 366), label('YAKIT MENZİLİ', 394),
    divider(422),
    ...LAMPS.map(([icon], i) => ({ t: 'icon', name: icon, x: lampX(i), y: 430, c: C.track })),
    ...dots(0),
  ],
  lit: [
    { t: 'poly', pts: [[16, 52], [36, 40], [36, 64]], c: C.green },
    { t: 'poly', pts: [[256, 52], [236, 40], [236, 64]], c: C.green },
    { t: 'circle', cx: 136, cy: 233, r: 26, c: '#FFFFFF', fill: true },
    { t: 'circle', cx: 136, cy: 233, r: 23, c: C.scania, fill: false, wd: 6 },
    ...[0, 1, 2, 3].map(i => ({ t: 'rect', x: 166 + i * 22, y: 322, w: 18, h: 13, r: 2, c: C.amber })),
    ...LAMPS.map(([icon, color], i) => ({ t: 'icon', name: icon, x: lampX(i), y: 430, c: color })),
  ],
  widgets: [
    ...header(false),
    { k: 'lamp', id: 'blinkL', x: 14, y: 38, w: 24, h: 28, expr: 'truck.lights.blinker.left.active' },
    { k: 'lamp', id: 'blinkR', x: 234, y: 38, w: 24, h: 28, expr: 'truck.lights.blinker.right.active' },
    { k: 'text', id: 'gear', x: 86, y: 40, w: 100, h: 24, font: 1, color: C.label, align: 'c', expr: 'x.gearText' },
    { k: 'text', id: 'speed', x: 16, y: 62, w: 240, h: 112, font: 4, color: C.text, align: 'c', expr: SPEED },
    { k: 'lamp', id: 'limitSign', x: 108, y: 205, w: 56, h: 56, expr: 'navigation.speedLimit.kph > 0' },
    { k: 'text', id: 'limit', x: 113, y: 220, w: 46, h: 26, font: 2, color: '#111111', align: 'c', crop: 'lit', show: 'navigation.speedLimit.kph > 0', expr: 'round(navigation.speedLimit.kph, 0)' },
    { k: 'text', id: 'cruise', x: 150, y: 286, w: 104, h: 26, font: 2, color: C.blue, align: 'r', expr: "truck.cruiseControl.enabled ? round(truck.cruiseControl.kph, 0) : '-'" },
    ...[0, 1, 2, 3].map(i => ({ k: 'lamp', id: `ret${i + 1}`, x: 166 + i * 22, y: 322, w: 18, h: 13, expr: `truck.brakes.retarder.level >= ${i + 1}` })),
    { k: 'text', id: 'dest', x: 96, y: 360, w: 158, h: 24, font: 1, color: C.text, align: 'r', expr: `navigation.distance > 0 ? round(navigation.distance / 1000, 0) + ' km · ' + ${hmSec('navigation.time')} : '-'` },
    { k: 'text', id: 'range', x: 130, y: 388, w: 124, h: 24, font: 1, color: C.text, align: 'r', expr: "round(truck.fuel.range, 0) + ' km'" },
    ...LAMPS.map(([icon, , expr], i) => ({ k: 'lamp', id: `lamp_${icon}`, x: lampX(i), y: 430, w: 24, h: 24, expr })),
  ],
});

pages.push({
  name: 'page2', title: 'İş ve yol', rotation: true,
  bg: [
    label('HEDEF', 42), label('ÇIKIŞ', 136),
    { t: 'rect', x: 20, y: 186, w: 232, h: 8, r: 4, c: C.track },
    divider(232),
    label('YÜK', 250), label('TESLİMATA KALAN', 278), label('KAZANÇ', 306),
    divider(332),
    label('DORSE', 350), label('SONRAKİ MOLA', 378),
    ...dots(1),
  ],
  widgets: [
    ...header(true),
    { k: 'text', id: 'city', x: 18, y: 58, w: 236, h: 38, font: 3, color: C.text, align: 'l', expr: `${HAS_JOB} ? job.destination.city.name : 'İş yok'` },
    { k: 'text', id: 'company', x: 20, y: 98, w: 232, h: 22, font: 0, color: C.soft, align: 'l', expr: 'job.destination.company.name' },
    { k: 'text', id: 'origin', x: 20, y: 152, w: 232, h: 22, font: 0, color: C.soft, align: 'l', expr: `${HAS_JOB} ? job.source.city.name + ' · ' + job.source.company.name : ''` },
    { k: 'bar', id: 'progress', x: 20, y: 186, w: 232, h: 8, color: C.blue, expr: `job.plannedDistance.km > 0 ? ${pct('job.plannedDistance.km - navigation.distance / 1000', 'job.plannedDistance.km')} : 0` },
    { k: 'text', id: 'kmLeft', x: 20, y: 200, w: 116, h: 24, font: 1, color: C.text, align: 'l', expr: "navigation.distance > 0 ? round(navigation.distance / 1000, 0) + ' km' : ''" },
    { k: 'text', id: 'eta', x: 136, y: 200, w: 116, h: 24, font: 1, color: C.text, align: 'r', expr: `navigation.distance > 0 ? ${hmSec('navigation.time')} + ' sa' : ''` },
    { k: 'text', id: 'cargo', x: 70, y: 244, w: 184, h: 24, font: 1, color: C.text, align: 'r', expr: `${HAS_JOB} ? job.cargo.name + ' · ' + round(job.cargo.mass / 1000, 0) + ' t' : '-'` },
    { k: 'text', id: 'due', x: 130, y: 272, w: 124, h: 24, font: 1, color: C.green, align: 'r', expr: `${HAS_JOB} ? ${hm('x.deliveryMinutes')} : '-'` },
    { k: 'text', id: 'income', x: 120, y: 300, w: 134, h: 24, font: 1, color: C.text, align: 'r', expr: `${HAS_JOB} ? job.income + ' EUR' : '-'` },
    { k: 'text', id: 'trailer', x: 70, y: 346, w: 184, h: 22, font: 0, color: C.text, align: 'r', expr: "trailer.attached ? trailer.brand.name + ' · ' + trailer.licensePlate.value : 'Bağlı değil'" },
    { k: 'text', id: 'rest', x: 130, y: 372, w: 124, h: 24, font: 1, color: C.amber, align: 'r', expr: `navigation.nextRestStop > 0 ? ${hm('navigation.nextRestStop')} : '-'` },
  ],
});

// systems: [label, value text, bar 0..100, warning formula]
const SYS = [
  ['YAKIT', "round(x.fuelPercent, 0) + '% · ' + round(truck.fuel.range, 0) + ' km'", 'x.fuelPercent', 'truck.fuel.warning.enabled'],
  ['ADBLUE', "round(x.adBluePercent, 0) + '%'", 'x.adBluePercent', 'truck.adBlue.warning.enabled'],
  ['FREN HAVASI', "format(x.airBar, 1) + ' bar'", pct('x.airBar', 13), 'truck.brakes.airPressure.warning.enabled || truck.brakes.airPressure.emergency.enabled'],
  ['SU SICAKLIĞI', "round(truck.engine.waterTemperature.value, 0) + ' °C'", pct('truck.engine.waterTemperature.value', 120), 'truck.engine.waterTemperature.warning.enabled'],
  ['YAĞ SICAKLIĞI', "round(truck.engine.oilTemperature.value, 0) + ' °C'", pct('truck.engine.oilTemperature.value', 150), 'truck.engine.oilTemperature.value > 130'],
  ['YAĞ BASINCI', "format(truck.engine.oilPressure.value * x.psiToBar, 1) + ' bar'", pct('truck.engine.oilPressure.value * x.psiToBar', 8), 'truck.engine.oilPressure.warning.enabled'],
  ['AKÜ', "format(truck.engine.batteryVoltage.value, 1) + ' V'", pct('truck.engine.batteryVoltage.value - 18', 12), 'truck.engine.batteryVoltage.warning.enabled'],
  ['FREN SICAKLIĞI', "round(truck.brakes.temperature.value, 0) + ' °C'", pct('truck.brakes.temperature.value', 400), 'truck.brakes.temperature.value > 350'],
];
const sysY = i => 42 + i * 50;
pages.push({
  name: 'page3', title: 'Araç sistemleri', rotation: true,
  bg: [
    ...SYS.flatMap(([text], i) => [label(text, sysY(i)), { t: 'rect', x: 20, y: sysY(i) + 22, w: 232, h: 6, r: 3, c: C.track }]),
    ...dots(2),
  ],
  widgets: [
    ...header(true),
    ...SYS.flatMap(([, value, bar, warn], i) => [
      { k: 'text', id: `sys${i}`, x: 110, y: sysY(i) - 4, w: 144, h: 22, font: 1, color: `${warn} ? '${C.red}' : '${C.text}'`, align: 'r', expr: value },
      { k: 'bar', id: `sysbar${i}`, x: 20, y: sysY(i) + 22, w: 232, h: 6, color: `${warn} ? '${C.red}' : ${i === 0 ? `'${C.amber}'` : i === 1 ? `'${C.blue}'` : `'${C.green}'`}`, expr: bar },
    ]),
  ],
});

const TRUCK = [['Motor', 'truck.damage.engine'], ['Şanzıman', 'truck.damage.transmission'], ['Kabin', 'truck.damage.cabin'], ['Şasi', 'truck.damage.chassis'], ['Tekerlekler', 'truck.damage.wheels']];
const TRAILER = [['Şasi', 'trailer.damage.chassis'], ['Tekerlekler', 'trailer.damage.wheels'], ['Kasa', 'trailer.body.damage'], ['Yük', 'trailer.damage.cargo']];
const dmgRow = (name, prop, y, id) => ({
  bg: [{ t: 'text', x: 20, y, s: 13, c: C.label, text: name }, { t: 'rect', x: 112, y: y + 4, w: 96, h: 8, r: 4, c: C.track }],
  widgets: [
    { k: 'bar', id: `${id}bar`, x: 112, y: y + 4, w: 96, h: 8, color: sev(`${prop} * 100`), expr: `${prop} * 100` },
    { k: 'text', id, x: 212, y: y - 3, w: 42, h: 22, font: 0, color: sev(`${prop} * 100`), align: 'r', expr: `round(${prop} * 100, 0) + '%'` },
  ],
});
const truckRows = TRUCK.map(([n, p], i) => dmgRow(n, p, 74 + i * 30, `dt${i}`));
const trailerRows = TRAILER.map(([n, p], i) => dmgRow(n, p, 262 + i * 30, `dr${i}`));
pages.push({
  name: 'page4', title: 'Hasar', rotation: true,
  bg: [
    { t: 'text', x: 20, y: 44, s: 13, c: C.soft, b: true, text: 'KAMYON' },
    ...truckRows.flatMap(r => r.bg),
    divider(226),
    { t: 'text', x: 20, y: 234, s: 13, c: C.soft, b: true, text: 'DORSE' },
    ...trailerRows.flatMap(r => r.bg),
    ...dots(3),
  ],
  widgets: [
    ...header(true),
    ...truckRows.flatMap(r => r.widgets),
    ...trailerRows.flatMap(r => r.widgets),
    { k: 'text', id: 'odo', x: 20, y: 400, w: 232, h: 22, font: 0, color: C.label, align: 'c', expr: "'Kilometre: ' + round(truck.odometer, 0) + ' km'" },
  ],
});

pages.push({
  name: 'page5', title: 'Kontak kapalı',
  showWhen: '!truck.electric.enabled',
  bg: [],
  widgets: [{ k: 'text', id: 'offclock', x: 36, y: 214, w: 200, h: 48, font: 3, color: C.dark, align: 'c', expr: 'x.gameClock' }],
});

const WARN = [
  ['truck.brakes.airPressure.emergency.enabled', "'DÜŞÜK HAVA BASINCI'", "format(x.airBar, 1) + ' bar · durmadan önce bekle'"],
  ['truck.engine.oilPressure.warning.enabled', "'DÜŞÜK YAĞ BASINCI'", "'Motoru durdur'"],
  ['truck.engine.waterTemperature.warning.enabled', "'MOTOR ÇOK SICAK'", "round(truck.engine.waterTemperature.value, 0) + ' °C · yavaşla'"],
];
const pick = i => WARN.slice(0, -1).reduceRight((acc, w) => `${w[0]} ? ${w[i]} : ${acc}`, WARN.at(-1)[i]);
pages.push({
  name: 'page6', title: 'İkaz',
  showWhen: `truck.engine.enabled && (${WARN.map(w => w[0]).join(' || ')})`,
  bg: [
    { t: 'rect', x: 16, y: 140, w: 240, h: 190, r: 12, c: C.scania },
    { t: 'rect', x: 18, y: 142, w: 236, h: 186, r: 11, c: '#2A0D0D' },
    { t: 'circle', cx: 136, cy: 190, r: 24, c: C.red, fill: false, wd: 4 },
    { t: 'text', x: 0, y: 172, w: W, s: 28, c: C.red, a: 'c', b: true, text: '!' },
  ],
  widgets: [
    ...header(true),
    { k: 'text', id: 'wtitle', x: 22, y: 232, w: 228, h: 30, font: 2, color: C.text, align: 'c', expr: pick(1) },
    { k: 'text', id: 'wdetail', x: 22, y: 270, w: 228, h: 44, font: 0, color: C.soft, align: 'c', expr: pick(2) },
  ],
});

// --- pictures: page backgrounds and lit versions, in Nextion picture-id order ------------------------
let pic = 0;
for (const p of pages) {
  p.pic = pic++;
  if (p.lit) p.litPic = pic++;
}

const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(here, 'layout.json'), JSON.stringify({ size: [W, H], bg: C.bg, fonts: FONTS, pages }, null, 2));

// --- the Studio display (device "Scania dikey"): pages, touch areas, widgets ------------------------
const studio = {
  id: 'scaniav', name: 'Scania dikey', enabled: false, port: '', via: 'octopus', baud: 115200, width: W, height: H,
  encoding: 'latin5', powerOffWhenIdle: true, idlePage: 'page1',
  // pages with a "show when" first (the first true one wins), then the touch rotation
  pages: [...pages.filter(p => p.showWhen).sort((a, b) => (a.name === 'page6' ? -1 : b.name === 'page6' ? 1 : 0)), ...pages.filter(p => !p.showWhen)]
    .map(p => ({ name: p.name, rotation: !!p.rotation, showWhen: p.showWhen ?? '', pic: p.pic, litPic: p.litPic ?? null })),
  hotspots: [
    { x: 50, y: 86, w: 50, h: 14, action: 'next' },
    { x: 0, y: 86, w: 50, h: 14, action: 'prev' },
  ],
  bindings: [],
  widgets: pages.flatMap(p => p.widgets.map(w => ({ page: p.name, ...w }))),
};
fs.writeFileSync(path.join(here, 'studio-display.json'), JSON.stringify(studio, null, 2));
console.log(`pages ${pages.length}, pictures ${pic}, widgets ${studio.widgets.length}`);
