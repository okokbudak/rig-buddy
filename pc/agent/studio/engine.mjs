// Studio engine: holds the configuration (studio.json), evaluates the formulas
// against live telemetry at up to 25 Hz and drives the outputs. Today the
// outputs are serial devices (Arduino gauge clusters); the others (Nextion,
// web dashboards) plug into the same tick.
import fs from 'node:fs';
import path from 'node:path';
import { compile, FormulaError } from './expr.mjs';
import { createNextion, normalizeNextion } from './nextion.mjs';
import { NEXTION_SEED } from './seed-nextion.mjs';
import { read } from './props.mjs';

const TICK_MS = 40; // 25 Hz, what the gauge firmware parses at most
const KEEPALIVE_MS = 500; // an unchanged line is repeated at least this often (gauges park without data)
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];
const IDLE = ['zeros', 'hold', 'none'];

// What the user's two SimHub "Custom Serial" devices sent (dashboard project): integers only,
// `v0,v1,v2\n`. Disabled until a port is chosen: SimHub must release the COM port first.
const SEED = {
  version: 1,
  serial: [
    {
      id: 'cluster1', name: 'Cluster 1', enabled: false, port: '', baud: 115200, hz: 25,
      separator: ',', terminator: '\\n', idle: 'zeros',
      channels: [
        { name: 'RPM', expr: 'truck.engine.rpm.value', min: 0, max: 3000 },
        { name: 'TURBO (bar x1000)', expr: 'controls.game.throttle * (truck.engine.rpm.value / max(truck.engine.rpm.max, 1)) * 3 * 1000', min: 0, max: 3000 },
        { name: 'AIR (bar x100)', expr: 'x.airBar * 100', min: 0, max: 1200 },
      ],
    },
    {
      id: 'cluster2', name: 'Cluster 2', enabled: false, port: '', baud: 115200, hz: 25,
      separator: ',', terminator: '\\n', idle: 'zeros',
      channels: [
        { name: 'SPEED (km/h x10)', expr: 'truck.speed.kph * 10', min: 0, max: 1200 },
        { name: 'ADBLUE (% x10)', expr: 'x.adBluePercent * 10', min: 0, max: 1000 },
        { name: 'FUEL (% x10)', expr: 'x.fuelPercent * 10', min: 0, max: 1000 },
      ],
    },
  ],
};

SEED.nextion = [NEXTION_SEED];

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Cleans a config coming from the editor (or an old file): unknown keys dropped, limits applied. */
export function normalize(cfg) {
  const out = { version: 1, serial: [], nextion: [] };
  const ids = new Set();
  for (const d of Array.isArray(cfg?.serial) ? cfg.serial.slice(0, 16) : []) {
    let id = str(d.id, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `dev${out.serial.length + 1}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const port = str(d.port, 8).toUpperCase();
    out.serial.push({
      id,
      name: str(d.name, 40, id),
      enabled: !!d.enabled,
      port: /^COM\d{1,3}$/.test(port) ? port : '',
      baud: BAUDS.includes(Number(d.baud)) ? Number(d.baud) : 115200,
      hz: Math.min(25, Math.max(1, Math.round(Number(d.hz) || 25))),
      separator: str(d.separator, 4, ','),
      terminator: ['\\n', '\\r\\n', '\\r', ''].includes(d.terminator) ? d.terminator : '\\n',
      idle: IDLE.includes(d.idle) ? d.idle : 'zeros',
      channels: (Array.isArray(d.channels) ? d.channels.slice(0, 32) : []).map(c => ({
        name: str(c.name, 40),
        expr: str(c.expr, 500),
        min: numOrNull(c.min),
        max: numOrNull(c.max),
      })),
    });
  }
  out.nextion = normalizeNextion(cfg?.nextion, ids);
  return out;
}

export function createEngine({ hub, getRaw, dataDir }) {
  const file = path.join(dataDir, 'studio.json');
  let config = load();
  let compiled = new Map(); // device id -> [{fn, error}]
  const runtime = new Map(); // device id -> {state, msg, line, values, lastLine, lastSent, sent}
  let desired = new Map(); // hub id -> "port@baud" currently asked of the hub
  let nextions = new Map(); // nextion id -> runtime from nextion.mjs
  const nxState = new Map(); // nextion id -> last {state, msg} the hub reported (a rebuilt runtime starts from it)
  const nxId = id => `nx:${id}`; // hub ids of Nextion displays (config ids never contain a colon)
  let lastRaw = null;

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!('nextion' in saved)) saved.nextion = SEED.nextion; // a file from before the Nextion part
      return normalize(saved);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('studio.json unreadable, starting from the defaults:', e.message);
      return normalize(SEED);
    }
  }

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, file);
  }

  function rt(id) {
    if (!runtime.has(id)) runtime.set(id, { state: 'off', msg: '', line: '', values: [], errors: [], lastLine: null, lastSent: 0, sent: 0 });
    return runtime.get(id);
  }

  function compileAll() {
    compiled = new Map();
    for (const d of config.serial) {
      compiled.set(d.id, d.channels.map(c => {
        if (!c.expr.trim()) return { fn: null, error: 'empty formula' };
        try {
          return { fn: compile(c.expr), error: null };
        } catch (e) {
          return { fn: null, error: e instanceof FormulaError ? e.message : String(e.message) };
        }
      }));
    }
  }

  /** Opens/closes hub ports so they match the configuration. */
  function syncPorts() {
    const want = new Map();
    for (const d of config.serial) if (d.enabled && d.port) want.set(d.id, `${d.port}@${d.baud}`);
    for (const d of config.nextion) if (d.enabled && d.port) want.set(nxId(d.id), `${d.port}@${d.baud}@bin`);
    for (const [id, key] of desired) {
      if (want.get(id) !== key) {
        hub.close(id);
        if (id.startsWith('nx:')) {
          nxState.delete(id.slice(3));
          nextions.get(id.slice(3))?.state('off', '');
        } else {
          const r = rt(id);
          r.state = 'off';
          r.msg = '';
          r.lastLine = null;
        }
      }
    }
    for (const [id, key] of want) {
      if (desired.get(id) !== key) {
        const [port, baud, bin] = key.split('@');
        hub.open(id, port, Number(baud), bin === 'bin');
        if (id.startsWith('nx:')) {
          nxState.set(id.slice(3), { state: 'connecting', msg: '' });
          nextions.get(id.slice(3))?.state('connecting', '');
        }
        else rt(id).state = 'connecting';
      }
    }
    desired = want;
  }

  function buildNextions() {
    const old = nextions;
    nextions = new Map();
    for (const d of config.nextion) {
      const prev = old.get(d.id);
      if (prev && JSON.stringify(prev.cfg) === JSON.stringify(d)) nextions.set(d.id, prev);
      else {
        const n = createNextion(d, { hub, hubId: nxId(d.id) });
        const last = nxState.get(d.id);
        if (last) n.state(last.state, last.msg); // the port stays open across an edit: say so, so it is initialised again
        nextions.set(d.id, n);
      }
    }
  }

  function apply(next) {
    config = normalize(next);
    compileAll();
    buildNextions();
    syncPorts();
    for (const id of [...runtime.keys()]) if (!config.serial.some(d => d.id === id)) runtime.delete(id);
    save();
    return config;
  }

  hub.events.on('connected', () => {
    desired = new Map(); // a restarted hub knows no ports
    syncPorts();
  });
  hub.events.on('disconnected', () => {
    for (const [id] of desired) {
      if (id.startsWith('nx:')) {
        nxState.set(id.slice(3), { state: 'error', msg: 'serial hub lost' });
        nextions.get(id.slice(3))?.state('error', 'serial hub lost');
      }
      else {
        const r = rt(id);
        r.state = 'error';
        r.msg = 'serial hub lost';
      }
    }
    desired = new Map();
  });
  hub.events.on('state', m => {
    if (m.id.startsWith('nx:')) {
      nxState.set(m.id.slice(3), { state: m.state, msg: m.msg || '' });
      nextions.get(m.id.slice(3))?.state(m.state, m.msg);
      return;
    }
    const r = rt(m.id);
    r.state = m.state;
    r.msg = m.msg || '';
    if (m.state !== 'open') r.lastLine = null; // resend as soon as it is back
  });
  hub.events.on('rx', m => {
    if (m.id.startsWith('nx:')) return void (m.b64 && nextions.get(m.id.slice(3))?.rx(Buffer.from(m.b64, 'base64')));
    const r = rt(m.id);
    r.rx = String(m.text).slice(0, 200);
  });

  function evalDevice(d, raw) {
    const r = rt(d.id);
    const cs = compiled.get(d.id) ?? [];
    const get = p => read(raw, p);
    const values = [];
    r.errors = [];
    d.channels.forEach((c, i) => {
      const f = cs[i];
      let v = 0;
      if (!f || f.error) r.errors[i] = f?.error ?? 'error';
      else {
        try {
          v = f.fn(get);
          if (typeof v === 'boolean') v = +v;
          v = Number(v);
          if (!Number.isFinite(v)) v = 0;
        } catch (e) {
          r.errors[i] = e.message;
          v = 0;
        }
      }
      if (c.min != null) v = Math.max(c.min, v);
      if (c.max != null) v = Math.min(c.max, v);
      values.push(Math.round(v));
    });
    return values;
  }

  function tick() {
    // nothing to drive and nobody looking at the Studio page: don't parse the telemetry 25x a second
    if (!engine.viewers && !config.serial.some(d => d.enabled) && !config.nextion.some(d => d.enabled)) return;
    const raw = getRaw();
    lastRaw = raw;
    const now = Date.now();
    for (const n of nextions.values()) n.tick(raw, now);
    for (const d of config.serial) {
      const r = rt(d.id);
      let values;
      if (raw == null && d.idle === 'none') continue;
      if (raw == null && d.idle === 'zeros') values = d.channels.map(() => 0);
      else if (raw == null && d.idle === 'hold' && r.values.length) values = r.values;
      else values = evalDevice(d, raw);
      r.values = values;
      const line = values.join(d.separator) + d.terminator.replace('\\n', '\n').replace('\\r', '\r');
      r.line = line;
      if (r.state !== 'open') continue;
      if (now - r.lastSent < 1000 / d.hz) continue;
      if (line === r.lastLine && now - r.lastSent < KEEPALIVE_MS) continue;
      hub.write(d.id, line);
      r.lastLine = line;
      r.lastSent = now;
      r.sent++;
    }
  }

  compileAll();
  buildNextions();
  syncPorts();
  setInterval(tick, TICK_MS).unref();

  const engine = {
    /** Studio pages currently watching live values. */
    viewers: 0,
    get config() { return config; },
    apply,
    get raw() { return lastRaw; },
    status() {
      return {
        hub: hub.connected,
        game: lastRaw != null,
        nextion: [...nextions.values()].map(n => n.status()),
        devices: config.serial.map(d => {
          const r = rt(d.id);
          return { id: d.id, state: r.state, msg: r.msg, line: r.line, values: r.values, errors: r.errors, sent: r.sent, rx: r.rx ?? '' };
        }),
      };
    },
    /** Next/previous page of a Nextion display (the editor's test buttons). */
    nextionNav(id, action) {
      nextions.get(id)?.nav(action);
    },
    /** One-off evaluation for the editor's "try it". */
    evaluate(expr) {
      try {
        const v = compile(String(expr))(p => read(lastRaw, p));
        return { value: typeof v === 'boolean' ? +v : v };
      } catch (e) {
        return { error: e.message };
      }
    },
  };
  return engine;
}
