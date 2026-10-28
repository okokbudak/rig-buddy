// Rig Buddy agent: runs on the gaming PC next to the navigation server and
// serves the head-unit app everything the navigation server doesn't:
//   ws://PC:62843/ws      -> {"type":"telemetry","data":{...}} at 5 Hz, {"type":"save",...} on new autosave,
//                            {"type":"radio","data":{name,genre,country,song}|null} when the in-game radio changes
//   GET  /profile         -> profile/economy summary from the latest save
//   GET  /jobs            -> freight-market offers, nearest pickup first
//   GET  /explored        -> {game, count, uids, hasUid}: roads/junctions the player has driven (from the save), as the uids the map tiles carry
//   GET  /media           -> the PC's music player: {active, app, title, artist, album, status, position, duration, shuffle, repeat, can*}
//   POST /media {action}  -> playpause | play | pause | next | previous | shuffle | repeat; answers with the new state
//   GET  /sound           -> {games: [{id, name, mods: [{name, active, guids}]}]}: the sound plugin's mods per game
//   POST /sound {game, mod, active} -> switches a sound mod on or off (the plugin loads it within a second)
//   GET  /tiles           -> {"ets2": {size, version}}: map files the app can download
//   GET  /tiles/ets2.mbtiles -> the map file itself
//   GET  /tiles/sprites.json|png -> the map's POI icons ("sprites" in /tiles)
//   POST /key {"action"}  -> (reserved) key emulation via RigBuddy.exe
// Clients are the app and RigBuddy.exe, never a browser: see fromWebPage().
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import tst from 'trucksim-telemetry';
import { WebSocketServer } from 'ws';
import { createRadio } from './radio.mjs';
import { findLatestSave, loadSave } from './save.mjs';
import { mediaCommand, mediaState } from './media.mjs';
import { setSoundMod, soundState } from './sound.mjs';

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
    // the truck's place at 5 Hz (the navigation server only pushes ~2 Hz): game metres as in its positionUpdate
    // (x = game X, z = game Z), heading in turns, speed in m/s; t = this PC's clock when it was read
    position: {
      x: tr.position.X,
      z: tr.position.Z,
      heading: tr.orientation.heading,
      speedMs: tr.speed.value,
      t: Date.now(),
    },
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

// --- in-game radio ---------------------------------------------------------------------------

// dev/demo/run-demo.ps1 (screenshots): a made-up station instead of what the game is playing
const DEMO_RADIO = process.env.RIGBUDDY_DEMO_RADIO ? JSON.parse(fs.readFileSync(process.env.RIGBUDDY_DEMO_RADIO, 'utf8')) : null;
const radioPayload = () => DEMO_RADIO ?? radio.state();
const radio = createRadio(() => broadcast({ type: 'radio', data: radioPayload() }));

const MAX_BODY = 16 * 1024; // the app sends nothing over the WebSocket; keep what a client may send small

// --- map tiles for the app -----------------------------------------------------------------
// Phones and tablets can't `adb push` the map: the app downloads data/<game>.mbtiles
// from here on first connect and again whenever `version` (size + mtime) changes.

const DATA_DIR = process.env.RIGBUDDY_DATA || path.resolve(import.meta.dirname, '../../data');

function tileFile(g) {
  const file = path.join(DATA_DIR, `${g}.mbtiles`);
  try {
    const st = fs.statSync(file);
    return { file, size: st.size, version: `${st.size}-${Math.floor(st.mtimeMs)}` };
  } catch {
    return null;
  }
}

/** Does this map file carry the road items' `uid` (so explored roads can be coloured)? Maps built before 0.2.6 do not. */
const uidCache = new Map();
function tileHasUid(g) {
  const t = tileFile(g);
  if (!t) return false;
  if (uidCache.has(t.version)) return uidCache.get(t.version);
  let has = false;
  try {
    const db = new DatabaseSync(t.file); // (only read: the `readOnly` option is newer than some Node 22 builds)
    const row = db.prepare("SELECT value FROM metadata WHERE name = 'json'").get();
    db.close();
    has = !!row && /"uid"\s*:/.test(String(row.value));
  } catch {
    has = false;
  }
  uidCache.set(t.version, has);
  return has;
}

// the map's POI icons (data/sprites/app.*, cut from the game's own icons by the pipeline)
const SPRITES = { json: 'application/json', png: 'image/png' };
function spriteFiles() {
  try {
    const st = Object.keys(SPRITES).map(ext => fs.statSync(path.join(DATA_DIR, 'sprites', `app.${ext}`)));
    const size = st.reduce((s, x) => s + x.size, 0);
    return { size, version: `${size}-${Math.floor(Math.max(...st.map(x => x.mtimeMs)))}` };
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
  const s = spriteFiles();
  if (s) out.sprites = s;
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

/**
 * True for requests made by a web page. Browsers send Origin with cross-site
 * fetches, every POST and every WebSocket; without this check (and with CORS
 * open) any site open on this PC or on the LAN could read
 * the profile, the telemetry and the radio. The Host check
 * stops DNS rebinding: a page whose own domain resolves to this PC is
 * same-origin, but its Host header carries that domain, not an address.
 */
function fromWebPage(req) {
  if (req.headers.origin != null) return true;
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  const me = os.hostname().toLowerCase();
  return !(net.isIP(host) || host === 'localhost' || host === me || host.startsWith(`${me}.`));
}

const server = http.createServer((req, res) => {
  if (fromWebPage(req)) {
    res.writeHead(403);
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/media') {
    // the PC's music player: GET what plays, POST {action: playpause|play|pause|next|previous|shuffle|repeat}
    if (req.method === 'GET') {
      mediaState().then(s => send(200, s), () => send(200, { active: false }));
      return;
    }
    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      req.on('data', c => { size += c.length; if (size > 1024) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        let action;
        try {
          action = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).action);
        } catch {
          return send(400, { error: 'bad request' });
        }
        mediaCommand(action).then(s => (s ? send(200, s) : send(404, { error: 'unknown action' })), () => send(502, { error: 'player' }));
      });
      return;
    }
    return send(405, { error: 'method' });
  }
  if (url.pathname === '/sound') {
    // the sound mods of the sound plugin: GET the list per game, POST {game, mod, active} switches one on or off
    if (req.method === 'GET') return send(200, soundState());
    if (req.method === 'POST') {
      let size = 0;
      const chunks = [];
      req.on('data', c => { size += c.length; if (size > 4096) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const state = setSoundMod(String(b.game), String(b.mod), !!b.active);
          return state ? send(200, state) : send(404, { error: 'no such game or sound mod' });
        } catch {
          return send(400, { error: 'bad request' });
        }
      });
      return;
    }
    return send(405, { error: 'method' });
  }
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
  if (url.pathname === '/explored') {
    // the roads and junctions the player has driven (from the save), as the uids the map tiles carry; hasUid: this PC's map has them
    if (!save) return send(503, { error: saveError || 'nosave' });
    return send(200, { game: save.game, count: save.explored.length, uids: save.explored, hasUid: tileHasUid(save.game), savedAt: save.savedAt });
  }
  if (url.pathname === '/tiles') return send(200, tilesIndex());
  const tile = /^\/tiles\/(ets2|ats)\.mbtiles$/.exec(url.pathname);
  if (tile) return sendTiles(req, res, tile[1]);
  const sprite = /^\/tiles\/sprites\.(json|png)$/.exec(url.pathname);
  if (sprite) {
    const file = path.join(DATA_DIR, 'sprites', `app.${sprite[1]}`);
    if (!fs.existsSync(file)) return send(404, { error: 'no sprites' });
    res.writeHead(200, { 'Content-Type': SPRITES[sprite[1]], 'Content-Length': fs.statSync(file).size });
    return fs.createReadStream(file).pipe(res);
  }
  send(404, { error: 'not found' });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_BODY, verifyClient: ({ req }) => !fromWebPage(req) });
wss.on('connection', ws => {
  if (latest) ws.send(JSON.stringify({ type: 'telemetry', data: latest }));
  ws.send(JSON.stringify({ type: 'radio', data: radioPayload() }));
});
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

server.listen(PORT, () => console.log(`Rig Buddy agent listening on port ${PORT}`));

setInterval(pollTelemetry, 1000 / TELEMETRY_HZ);
setInterval(pollSave, SAVE_POLL_MS);
pollSave();
