// Studio engine: holds the configuration (studio.json), evaluates the formulas
// against live telemetry at up to 25 Hz and drives the outputs. Today the
// outputs are serial devices (gauge boards such as the Octopus Pro) and Nextion
// displays; others (web dashboards) plug into the same tick.
import fs from 'node:fs';
import path from 'node:path';
import { compile, FormulaError } from './expr.mjs';
import { createNextion, normalizeNextion, directFrames, tunnelLines, tunnelFrame } from './nextion.mjs';
import { read } from './props.mjs';
import { BOARD_TYPES, normalizeMotor, motorCommand, parseCfg, parseHello, motorDiff } from './board.mjs';

const TICK_MS = 40; // 25 Hz, what the gauge firmware parses at most
const KEEPALIVE_MS = 500; // an unchanged line is repeated at least this often (gauges park without data)
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];
const IDLE = ['zeros', 'hold', 'none'];

// A fresh install starts empty: the user adds a gauge board on the Connections page
// ("Identify board" reads the Octopus' settings) and a display on the Display page.
const SEED = { version: 1, serial: [], nextion: [] };

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function normalizeChannel(c) {
  return {
    name: str(c.name, 40),
    expr: str(c.expr, 500),
    min: numOrNull(c.min),
    max: numOrNull(c.max),
    // optional dial calibration in real units: the formula's value `lo` is sent as `min`, `hi` as `max`
    lo: numOrNull(c.lo),
    hi: numOrNull(c.hi),
    unit: str(c.unit, 12),
    preset: str(c.preset, 24),
  };
}

/** Cleans a config coming from the editor (or an old file): unknown keys dropped, limits applied. */
export function normalize(cfg) {
  const out = { version: 1, serial: [], nextion: [] };
  const ids = new Set();
  for (const d of Array.isArray(cfg?.serial) ? cfg.serial.slice(0, 16) : []) {
    let id = str(d.id, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `dev${out.serial.length + 1}`;
    while (ids.has(id)) id += '_';
    ids.add(id);
    const port = str(d.port, 8).toUpperCase();
    const board = BOARD_TYPES.includes(d.board) ? d.board : '';
    const dev = {
      id,
      name: str(d.name, 40, id),
      enabled: !!d.enabled,
      port: /^COM\d{1,3}$/.test(port) ? port : '',
      baud: BAUDS.includes(Number(d.baud)) ? Number(d.baud) : 115200,
      hz: Math.min(25, Math.max(1, Math.round(Number(d.hz) || 25))),
      separator: str(d.separator, 4, ','),
      terminator: ['\\n', '\\r\\n', '\\r', ''].includes(d.terminator) ? d.terminator : '\\n',
      idle: IDLE.includes(d.idle) ? d.idle : 'zeros',
      board,
      motors: board ? (Array.isArray(d.motors) ? d.motors.slice(0, 16) : []).map(normalizeMotor) : [],
      channels: (Array.isArray(d.channels) ? d.channels.slice(0, 32) : []).map(normalizeChannel),
    };
    if (board) {
      // a board with motor sockets: channel n is MOTORn, its scale is the motor's own "full" value
      if (!dev.motors.length) dev.motors = Array.from({ length: 6 }, () => normalizeMotor());
      dev.channels = dev.motors.map((m, i) => ({ ...(dev.channels[i] ?? normalizeChannel({})), min: 0, max: m.full }));
      dev.separator = ',';
      dev.terminator = '\\n';
    }
    out.serial.push(dev);
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
  // Revision of the configuration: an editor saves the whole config, so one that loaded an
  // older revision (a forgotten browser tab) must not overwrite newer settings.
  const revBoot = Date.now().toString(36);
  let revCount = 0;

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
    for (const d of config.nextion) if (d.enabled && d.port && !d.via) want.set(nxId(d.id), `${d.port}@${d.baud}@bin`);
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
          followVia(id);
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

  /** A display connected `via` a serial device is as connected as that device (and off while disabled). */
  function viaState(d) {
    if (!d.enabled) return { state: 'off', msg: '' };
    if (!config.serial.some(s => s.id === d.via)) return { state: 'error', msg: 'the device it is connected through is gone' };
    const r = rt(d.via);
    return { state: r.state, msg: r.msg };
  }

  function followVia(serialId) {
    for (const d of config.nextion) {
      if (d.via !== serialId) continue;
      const s = viaState(d);
      nextions.get(d.id)?.state(s.state, s.msg);
    }
  }

  function buildNextions() {
    const old = nextions;
    nextions = new Map();
    for (const d of config.nextion) {
      const prev = old.get(d.id);
      if (prev && JSON.stringify(prev.cfg) === JSON.stringify(d)) nextions.set(d.id, prev);
      else {
        const out = d.via
          ? cmds => hub.write(d.via, tunnelLines(cmds))
          : cmds => hub.write(nxId(d.id), directFrames(cmds));
        const n = createNextion(d, { out });
        const last = d.via ? viaState(d) : nxState.get(d.id);
        if (last) n.state(last.state, last.msg); // the port stays open across an edit: say so, so it is initialised again
        nextions.set(d.id, n);
      }
    }
  }

  function apply(next) {
    revCount++;
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
        followVia(id);
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
    if (m.state !== 'open') {
      r.lastLine = null; // resend as soon as it is back
      r.board = null; // whatever was read may not be what is plugged in next
    }
    followVia(m.id);
  });
  hub.events.on('rx', m => {
    if (m.id.startsWith('nx:')) return void (m.b64 && nextions.get(m.id.slice(3))?.rx(Buffer.from(m.b64, 'base64')));
    const frame = tunnelFrame(m.text);
    if (frame) {
      // a display behind this device (Octopus pass-through) sent something
      for (const d of config.nextion) if (d.via === m.id && d.enabled) nextions.get(d.id)?.rx(frame);
      return;
    }
    const r = rt(m.id);
    r.rx = String(m.text).slice(0, 200);
    waiters.get(m.id)?.feed(String(m.text).trim()); // an upload/read waiting for this board's answer
  });

  // --- talking to a board: one question at a time per device, answered by its next line(s) ---------
  const waiters = new Map(); // device id -> {feed}
  const locks = new Map(); // device id -> promise of the operation running on it

  function exchange(id, line, isEnd, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const lines = [];
      const done = () => { clearTimeout(timer); waiters.delete(id); };
      const timer = setTimeout(() => { done(); reject(new Error(`no answer to "${line}"`)); }, timeoutMs);
      waiters.set(id, {
        feed(text) {
          if (!text || text.startsWith('@')) return;
          lines.push(text);
          if (isEnd(text)) { done(); resolve(lines); }
        },
      });
      hub.write(id, `${line}\n`);
    });
  }
  const isReply = t => /^(OK|ERR)\b/.test(t);

  /** Runs `fn` alone on device `id` (an upload must not interleave with a read). */
  function withBoard(id, fn) {
    const d = config.serial.find(x => x.id === id);
    if (!d) return Promise.reject(new Error('no such device'));
    if (!d.enabled || rt(id).state !== 'open') return Promise.reject(new Error('the board is not connected'));
    const run = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(() => fn(d));
    locks.set(id, run);
    return run;
  }

  async function readBoard(d) {
    const hello = parseHello((await exchange(d.id, '?', t => /^OCTOPUS-GAUGES|^ERR/.test(t))).at(-1));
    if (!hello) throw new Error('this board did not answer like an Octopus gauge board');
    if (!hello.cfg) throw new Error(`firmware ${hello.version} cannot keep settings: update it to 0.7 or newer`);
    const cfg = parseCfg(await exchange(d.id, 'CFG?', t => /^CFG END|^ERR/.test(t), 4000));
    const info = { ...hello, ...cfg, readAt: Date.now() };
    rt(d.id).board = info;
    return info;
  }

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
      if (c.lo != null && c.hi != null && c.hi !== c.lo && c.min != null && c.max != null) {
        v = c.min + ((v - c.lo) / (c.hi - c.lo)) * (c.max - c.min); // real units -> what the board expects
      }
      const t = r.test;
      if (t && t.ch === i && Date.now() < t.until && c.min != null && c.max != null) {
        const phase = (Date.now() - t.from) / (t.until - t.from); // 0..1: up to full scale and back
        v = c.min + (c.max - c.min) * Math.sin(Math.PI * phase);
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
      const testing = r.test && now < r.test.until;
      if (raw == null && d.idle === 'none' && !testing) continue;
      if (raw == null && d.idle === 'zeros' && !testing) values = d.channels.map(() => 0);
      else if (raw == null && d.idle === 'hold' && r.values.length && !testing) values = r.values;
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
    get rev() { return `${revBoot}.${revCount}`; },
    apply,
    get raw() { return lastRaw; },
    status() {
      return {
        hub: hub.connected,
        game: lastRaw != null,
        nextion: [...nextions.values()].map(n => n.status()),
        devices: config.serial.map(d => {
          const r = rt(d.id);
          const board = r.board && d.board
            ? { version: r.board.version, saved: r.board.saved, readAt: r.board.readAt, differs: motorDiff(d.motors, r.board.motors.slice(0, d.motors.length)) }
            : null;
          return { id: d.id, state: r.state, msg: r.msg, line: r.line, values: r.values, errors: r.errors, sent: r.sent, rx: r.rx ?? '', board };
        }),
      };
    },
    /** Reads a board's own settings (it must be connected). */
    boardRead(id) {
      return withBoard(id, readBoard);
    },
    /** Takes a connected board as it is: marks the device as that board type and copies its settings in. */
    boardAdopt(id) {
      return withBoard(id, async d => {
        const info = await readBoard(d);
        const next = JSON.parse(JSON.stringify(config));
        const dev = next.serial.find(x => x.id === id);
        dev.board = info.type;
        dev.motors = info.motors.slice(0, info.count || info.motors.length);
        apply(next);
        return info;
      });
    },
    /** Uploads the wanted settings, saves them in the board's flash, reads them back to check. */
    boardUpload(id) {
      return withBoard(id, async d => {
        if (!d.board) throw new Error('this device is not a board with its own settings');
        const steps = [];
        for (const [i, m] of d.motors.entries()) steps.push(motorCommand(i, m));
        const nx = config.nextion.find(n => n.enabled && n.via === id);
        steps.push(`CFG NX en=${nx ? 1 : 0} baud=${nx?.baud ?? 115200}`);
        for (const line of steps) {
          const reply = (await exchange(d.id, line, isReply)).at(-1);
          if (!reply.startsWith('OK')) throw new Error(`${reply} (${line.split(' ').slice(0, 2).join(' ')})`);
        }
        const saved = (await exchange(d.id, 'CFG SAVE', isReply, 10000)).at(-1); // erasing the flash sector takes a moment
        if (!saved.startsWith('OK')) throw new Error(saved);
        const info = await readBoard(d);
        const diff = motorDiff(d.motors, info.motors.slice(0, d.motors.length));
        if (diff.length) throw new Error(`the board reads back different settings for MOTOR${diff.join(', MOTOR')}`);
        if (!info.saved) throw new Error('the board says the settings are not saved');
        return info;
      });
    },
    /** Sweeps one channel to full scale and back over `ms` (the editor's "test needle" button). */
    testChannel(id, ch, ms = 3000) {
      const d = config.serial.find(x => x.id === id);
      if (!d || !d.channels[ch]) return false;
      const now = Date.now();
      rt(id).test = { ch, from: now, until: now + Math.min(10000, Math.max(500, ms)) };
      return true;
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
