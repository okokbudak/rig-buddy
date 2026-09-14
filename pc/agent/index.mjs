// Rig Buddy agent: runs on the gaming PC next to the navigation server and
// serves the head-unit app everything the navigation server doesn't:
//   ws://PC:62843/ws      -> {"type":"telemetry","data":{...}} at 5 Hz, {"type":"save",...} on new autosave
//   GET  /profile         -> profile/economy summary from the latest save
//   GET  /jobs            -> freight-market offers, nearest pickup first
//   GET  /tiles           -> {"ets2": {size, version}}: map files the app can download
//   GET  /tiles/ets2.mbtiles -> the map file itself
//   POST /key {"action"}  -> (reserved) key emulation via RigBuddy.exe
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import tst from 'trucksim-telemetry';
import { WebSocketServer } from 'ws';
import { createMedia } from './media.mjs';
import { createRadio } from './radio.mjs';
import { findLatestSave, loadSave } from './save.mjs';

const PORT = Number(process.env.AGENT_PORT || 62843);
const TELEMETRY_HZ = 5;
const SAVE_POLL_MS = 5000;

let latest = null;       // last telemetry summary
let rawTruckPos = null;  // { x, z } game meters
let game = 'ets2';
let save = null;         // loadSave() result
let saveError = null;

// --- telemetry ------------------------------------------------------------------

function summarize(t) {
  const tr = t.truck, eng = tr.engine, fuel = tr.fuel;
  const trailer = t.trailer ?? {};
  return {
    game: t.game.game.name,
    paused: t.game.paused,
    gameTime: t.game.time.value, // minutes since day 0
    scale: t.game.scale,
    truck: {
      brand: tr.brand?.name ?? tr.make?.name ?? '',
      model: tr.model?.name ?? '',
      plate: tr.licensePlate?.value ?? '',
      speedKph: tr.speed.kph,
      cruise: { enabled: tr.cruiseControl.enabled, kph: tr.cruiseControl.kph },
      rpm: eng.rpm.value,
      rpmMax: eng.rpm.max,
      gear: tr.transmission.gear.displayed,
      forwardGears: tr.transmission.forwardGears,
      engineOn: eng.enabled,
      electricOn: tr.electric.enabled,
      fuel: { liters: fuel.value, capacity: fuel.capacity, avgLPer100: fuel.avgConsumption * 100, rangeKm: fuel.range, warning: fuel.warning.enabled },
      adBlue: { liters: tr.adBlue.value, capacity: tr.adBlue.capacity, warning: tr.adBlue.warning.enabled },
      oilPressure: { value: eng.oilPressure.value, warning: eng.oilPressure.warning.enabled },
      oilTemp: eng.oilTemperature.value,
      waterTemp: { value: eng.waterTemperature.value, warning: eng.waterTemperature.warning.enabled },
      battery: { volts: eng.batteryVoltage.value, warning: eng.batteryVoltage.warning.enabled },
      airPressure: { value: tr.brakes.airPressure.value, warning: tr.brakes.airPressure.warning.enabled, emergency: tr.brakes.airPressure.emergency.enabled },
      brakeTemp: tr.brakes.temperature.value,
      parkingBrake: tr.brakes.parking.enabled,
      motorBrake: tr.brakes.motor.enabled,
      retarder: { level: tr.brakes.retarder.level, steps: tr.brakes.retarder.steps },
      diffLock: tr.differential.lock?.enabled ?? false,
      odometerKm: tr.odometer,
      wipers: tr.wipers.enabled,
      lights: {
        low: tr.lights.beamLow.enabled,
        high: tr.lights.beamHigh.enabled,
        parking: tr.lights.parking.enabled,
        beacon: tr.lights.beacon.enabled,
        hazard: tr.lights.hazard?.enabled ?? false,
        blinkerLeft: tr.lights.blinker.left.active,
        blinkerRight: tr.lights.blinker.right.active,
        auxFront: tr.lights.auxFront.value,
        auxRoof: tr.lights.auxRoof.value,
      },
      damage: pct(tr.damage),
    },
    trailer: {
      attached: !!trailer.attached,
      name: trailer.model?.name ?? '',
      damage: trailer.damage ? pct(trailer.damage) : null,
    },
    job: t.job?.destination?.city?.id
      ? {
          cargo: t.job.cargo.name,
          massT: Math.round(t.job.cargo.mass / 100) / 10,
          cargoDamage: Math.round(t.job.cargo.damage * 1000) / 10,
          loaded: t.job.cargo.isLoaded,
          income: t.job.income,
          source: `${t.job.source.company.name}, ${t.job.source.city.name}`,
          destination: `${t.job.destination.company.name}, ${t.job.destination.city.name}`,
          plannedKm: t.job.plannedDistance.km,
          deliveryTime: t.job.expectedDeliveryTimestamp.value, // game minutes
          market: t.job.market?.name ?? '',
          special: t.job.isSpecial,
        }
      : null,
    navigation: {
      distanceKm: t.navigation.distance / 1000,
      timeMin: t.navigation.time / 60,
      speedLimitKph: t.navigation.speedLimit.kph,
      nextRestStopMin: t.navigation.nextRestStop,
    },
  };
}

const pct = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round((v ?? 0) * 1000) / 10]));

function pollTelemetry() {
  let t = null;
  try {
    t = tst.getData();
  } catch {
    t = null;
  }
  if (!t || (t.truck.position.X === 0 && t.truck.position.Z === 0)) {
    if (latest !== null) broadcast({ type: 'telemetry', data: null });
    latest = null;
    return;
  }
  try {
    latest = summarize(t);
    rawTruckPos = { x: t.truck.position.X, z: t.truck.position.Z };
    const g = latest.game === 'ats' ? 'ats' : 'ets2';
    if (g !== game) {
      game = g;
      save = null;
      lastSaveMtime = 0;
      radio.setGame(g);
    }
    broadcast({ type: 'telemetry', data: latest });
  } catch (e) {
    console.warn('telemetry summarize failed:', e.message);
  }
}

// --- saves -------------------------------------------------------------------------

let lastSaveMtime = 0;
function pollSave() {
  try {
    const found = findLatestSave(game);
    if (!found || found.mtimeMs === lastSaveMtime) return;
    lastSaveMtime = found.mtimeMs;
    const t0 = Date.now();
    save = loadSave(game);
    saveError = null;
    console.log(`save loaded (${Date.now() - t0} ms): ${save.jobs.length} offers, money ${save.profile.money} — ${found.file}`);
    broadcast({ type: 'save', data: { savedAt: save.savedAt, jobs: save.jobs.length } });
  } catch (e) {
    saveError = e.message;
    console.warn('save load failed:', e.message);
  }
}

function jobsForApp(limit) {
  if (!save) return [];
  const scale = game === 'ats' ? 20 : 19;
  return save.jobs
    .map(j => ({
      ...j,
      pickupKm: rawTruckPos && j.source.x != null
        ? Math.round((Math.hypot(j.source.x - rawTruckPos.x, j.source.y - rawTruckPos.z) * scale) / 1000)
        : null,
    }))
    .sort((a, b) => (a.pickupKm ?? 1e9) - (b.pickupKm ?? 1e9))
    .slice(0, limit)
    .map(({ source: { x, y, ...src }, ...rest }) => ({ ...rest, source: src }));
}

// --- media (PC players via the bridge) + in-game radio ------------------------------------

const mediaPayload = () => ({ ...(media.state() ?? { sessions: [] }), radio: radio.state() });
const media = createMedia(() => broadcast({ type: 'media', data: mediaPayload() }));
const radio = createRadio(() => broadcast({ type: 'media', data: mediaPayload() }));

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
}

// --- map tiles for the app -----------------------------------------------------------------
// Phones and tablets can't `adb push` the map: the app downloads data/<game>.mbtiles
// from here on first connect and again whenever `version` (size + mtime) changes.

const DATA_DIR = process.env.ETS2NAV_DATA || path.resolve(import.meta.dirname, '../../data');

function tileFile(g) {
  const file = path.join(DATA_DIR, `${g}.mbtiles`);
  try {
    const st = fs.statSync(file);
    return { file, size: st.size, version: `${st.size}-${Math.floor(st.mtimeMs)}` };
  } catch {
    return null;
  }
}

function tilesIndex() {
  const out = {};
  for (const g of ['ets2', 'ats']) {
    const t = tileFile(g);
    if (t) out[g] = { size: t.size, version: t.version };
  }
  return out;
}

function sendTiles(req, res, g) {
  const t = tileFile(g);
  if (!t) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `no ${g}.mbtiles` }));
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': t.size,
    ETag: `"${t.version}"`,
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(t.file).pipe(res);
}

// --- HTTP + WebSocket --------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') {
    // clients: connected apps (head units / phones), shown in the PC app's window
    return send(200, { ok: true, telemetry: latest !== null, save: !!save, clients: wss.clients.size });
  }
  if (url.pathname === '/profile') {
    if (!save) return send(503, { error: saveError || 'nosave' });
    return send(200, { ...save.profile, currency: save.currency, gameTime: save.gameTime, savedAt: save.savedAt });
  }
  if (url.pathname === '/jobs') {
    if (!save) return send(503, { error: saveError || 'nosave' });
    const limit = Math.min(500, Number(url.searchParams.get('limit') || 200));
    return send(200, { savedAt: save.savedAt, gameTime: save.gameTime, currency: save.currency, jobs: jobsForApp(limit) });
  }
  if (url.pathname === '/tiles') return send(200, tilesIndex());
  const tile = /^\/tiles\/(ets2|ats)\.mbtiles$/.exec(url.pathname);
  if (tile) return sendTiles(req, res, tile[1]);
  if (url.pathname === '/media') return send(200, mediaPayload());
  if (url.pathname.startsWith('/media/art/')) {
    const a = media.art(url.pathname.slice('/media/art/'.length));
    if (!a) return send(404, { error: 'no art' });
    res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': 'max-age=86400' });
    return res.end(a.data);
  }
  if (url.pathname === '/media/cmd' && req.method === 'POST') {
    readBody(req).then(cmd => {
      const allowed = ['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'volume', 'select'];
      if (!cmd || !allowed.includes(cmd.cmd)) return send(400, { error: 'bad command' });
      send(media.command(cmd) ? 200 : 503, { ok: true });
    });
    return;
  }
  send(404, { error: 'not found' });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  if (latest) ws.send(JSON.stringify({ type: 'telemetry', data: latest }));
  ws.send(JSON.stringify({ type: 'media', data: mediaPayload() }));
});
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

server.listen(PORT, () => console.log(`Rig Buddy agent listening on port ${PORT}`));
setInterval(pollTelemetry, 1000 / TELEMETRY_HZ);
setInterval(pollSave, SAVE_POLL_MS);
pollSave();
