// Nextion displays (the Scania cluster on COM13): what SimHub's Nextion plugin did.
//
// A device has pages and bindings. A binding is `page1.tgear.txt` = formula; only the
// bindings of the page on screen are sent, and only when their value changed (writing a
// component redraws it, so re-sending unchanged values makes the display flicker). The
// display announces a restart with 0x88, then everything is sent again. Commands
// are plain Nextion instructions ending in FF FF FF:
//   .txt          page.name.txt="text"
//   .vis          vis name,0|1           (yes/no formula)
//   other attrs   name.val=123           (val, pic, pco, bco, x, y ...: whole numbers)
// Pages: the `rotation` pages are what the touch hotspots (and the Next/Previous
// buttons) cycle through; a page with a "show when" formula pops up while it is true
// (ignition off -> dark page); `idlePage` is shown while no game runs, and with
// "power off" the display sleeps then.
import { compile, FormulaError } from './expr.mjs';
import { read } from './props.mjs';

const FF3 = Buffer.from([0xff, 0xff, 0xff]);
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 512000, 921600];
const PAGE_SETTLE_MS = 150; // a display needs a moment to load a page before it takes commands
const TOUCH_DEBOUNCE_MS = 350;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const ATTR = /^[a-z][a-z0-9]{0,15}$/;
const ACTIONS = /^(next|prev|page:[A-Za-z][A-Za-z0-9_]{0,23})$/;

const str = (v, max, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

/** Cleans the nextion part of a config. */
export function normalizeNextion(list, takenIds) {
  const out = [];
  for (const d of Array.isArray(list) ? list.slice(0, 4) : []) {
    let id = str(d.id, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `nextion${out.length + 1}`;
    while (takenIds.has(id)) id += '_';
    takenIds.add(id);
    const port = str(d.port, 8).toUpperCase();
    const pages = (Array.isArray(d.pages) ? d.pages.slice(0, 24) : [])
      .map(p => ({ name: str(p.name, 24), rotation: !!p.rotation, showWhen: str(p.showWhen, 500) }))
      .filter(p => NAME.test(p.name));
    out.push({
      id,
      name: str(d.name, 40, id),
      enabled: !!d.enabled,
      port: /^COM\d{1,3}$/.test(port) ? port : '',
      baud: BAUDS.includes(Number(d.baud)) ? Number(d.baud) : 115200,
      width: num(d.width, 64, 2000, 480),
      height: num(d.height, 64, 2000, 272),
      powerOffWhenIdle: !!d.powerOffWhenIdle,
      idlePage: NAME.test(str(d.idlePage, 24)) ? d.idlePage : '',
      pages,
      hotspots: (Array.isArray(d.hotspots) ? d.hotspots.slice(0, 16) : []).map(h => ({
        x: num(h.x, 0, 100, 0), y: num(h.y, 0, 100, 0), w: num(h.w, 1, 100, 10), h: num(h.h, 1, 100, 10),
        action: ACTIONS.test(str(h.action, 40)) ? h.action : 'next',
      })),
      bindings: (Array.isArray(d.bindings) ? d.bindings.slice(0, 400) : []).map(b => ({
        target: str(b.target, 64),
        expr: str(b.expr, 800),
        decimals: b.decimals === '' || b.decimals == null ? null : num(b.decimals, 0, 6, null),
      })).filter(b => b.target || b.expr),
    });
  }
  return out;
}

/** "page1.tgear.txt" -> {page, obj, attr}; null when it is not a valid target. */
export function parseTarget(target) {
  const m = /^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\.([a-z][a-z0-9]*)$/.exec(target);
  return m && ATTR.test(m[3]) ? { page: m[1], obj: m[2], attr: m[3] } : null;
}

function formatText(v, decimals) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '0';
    if (decimals != null) return v.toFixed(decimals);
    return Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  }
  return String(v).replace(/[\u0000-\u001f"\\]/g, ' ').replace(/[^\u0020-\u00ff]/g, '?');
}

export function createNextion(cfg, { hub, hubId }) {
  const target = new Map(); // "page.obj.attr" -> compiled binding
  const bindings = cfg.bindings.map(b => {
    const t = parseTarget(b.target);
    let fn = null, error = null;
    if (!t) error = 'target must look like page1.object.attribute';
    else if (!b.expr.trim()) error = 'empty formula';
    else {
      try { fn = compile(b.expr); } catch (e) { error = e instanceof FormulaError ? e.message : e.message; }
    }
    return { ...b, t, fn, error, value: '', cmd: '' };
  });
  const pages = cfg.pages.map(p => {
    let fn = null;
    if (p.showWhen.trim()) {
      try { fn = compile(p.showWhen); } catch { fn = () => false; }
    }
    return { ...p, fn };
  });
  const rotation = pages.filter(p => p.rotation).map(p => p.name);

  const st = {
    state: 'off', msg: '', page: '', userPage: 0, sent: 0, touch: '', asleep: null,
    cache: new Map(), resets: 0, holdUntil: 0, lastTouchAt: 0, rx: Buffer.alloc(0),
  };

  const send = cmds => {
    if (!cmds.length) return;
    const parts = [];
    for (const c of cmds) parts.push(Buffer.from(c, 'latin1'), FF3);
    hub.write(hubId, Buffer.concat(parts));
    st.sent += cmds.length;
  };

  function showPage(name, now) {
    if (name === st.page) return;
    st.page = name;
    st.cache.clear();
    st.holdUntil = now + PAGE_SETTLE_MS;
    send([`page ${name}`]);
  }

  function command(b, raw) {
    const { obj, attr } = b.t;
    const get = p => read(raw, p);
    let v = b.fn(get);
    if (attr === 'txt') {
      b.value = formatText(v, b.decimals);
      return `${obj}.txt="${b.value}"`;
    }
    if (attr === 'vis') {
      b.value = v ? '1' : '0';
      return `vis ${obj},${b.value}`;
    }
    v = Number(typeof v === 'boolean' ? +v : v);
    b.value = String(Number.isFinite(v) ? Math.round(v) : 0);
    return `${obj}.${attr}=${b.value}`;
  }

  function chosenPage(raw) {
    if (raw == null) return cfg.idlePage || rotation[st.userPage] || rotation[0] || '';
    const get = p => read(raw, p);
    for (const p of pages) {
      if (!p.fn) continue;
      try {
        if (p.fn(get)) return p.name;
      } catch { /* a broken condition never wins */ }
    }
    return rotation[st.userPage] ?? rotation[0] ?? '';
  }

  function onOpen() {
    st.page = '';
    st.asleep = null;
    st.cache.clear();
    st.rx = Buffer.alloc(0);
    // end any half-written command, stop the per-command replies, report touches as x/y
    send(['', 'bkcmd=0', 'sendxy=1']);
  }

  function step(delta) {
    if (!rotation.length) return;
    const cur = Math.max(0, rotation.indexOf(st.page));
    st.userPage = (cur + delta + rotation.length) % rotation.length;
  }

  function hotspot(xPx, yPx, now) {
    if (now - st.lastTouchAt < TOUCH_DEBOUNCE_MS) return;
    const xp = (xPx / cfg.width) * 100, yp = (yPx / cfg.height) * 100;
    st.touch = `${xPx},${yPx}`;
    for (const h of cfg.hotspots) {
      if (xp < h.x || xp > h.x + h.w || yp < h.y || yp > h.y + h.h) continue;
      st.lastTouchAt = now;
      if (h.action === 'next') step(1);
      else if (h.action === 'prev') step(-1);
      else {
        const i = rotation.indexOf(h.action.slice(5));
        if (i >= 0) st.userPage = i;
      }
      return;
    }
  }

  return {
    id: cfg.id,
    cfg,
    state(s, msg) {
      st.state = s;
      st.msg = msg || '';
      if (s === 'open') onOpen();
    },
    /** Bytes the display sent: touch coordinates arrive as 67 xh xl yh yl state FF FF FF. */
    rx(buf, now = Date.now()) {
      st.rx = Buffer.concat([st.rx, buf]).subarray(-256);
      for (;;) {
        const end = st.rx.indexOf(FF3);
        if (end < 0) break;
        const frame = st.rx.subarray(0, end);
        st.rx = st.rx.subarray(end + 3);
        if (frame.length === 1 && frame[0] === 0x88) {
          // the display (re)started (power-up, its own watchdog, an upload): it forgot page and values
          st.resets++;
          st.page = '';
          st.cache.clear();
          st.asleep = null;
          send(['bkcmd=0', 'sendxy=1']);
        } else if (frame.length === 6 && frame[0] === 0x67 && frame[5] === 1) hotspot((frame[1] << 8) | frame[2], (frame[3] << 8) | frame[4], now);
      }
    },
    /** Next/previous page, as a touch hotspot would. */
    nav(action) {
      if (action === 'next') step(1);
      else if (action === 'prev') step(-1);
      else if (action?.startsWith('page:')) {
        const i = rotation.indexOf(action.slice(5));
        if (i >= 0) st.userPage = i;
      }
    },
    tick(raw, now) {
      if (st.state !== 'open') return;
      if (raw == null && cfg.powerOffWhenIdle) {
        if (st.asleep !== true) {
          send(['sleep=1']);
          st.asleep = true;
          st.page = '';
        }
        return;
      }
      if (st.asleep !== false) {
        send(['sleep=0']);
        st.asleep = false;
        st.holdUntil = now + PAGE_SETTLE_MS;
        st.cache.clear();
      }
      const wanted = chosenPage(raw);
      if (wanted) showPage(wanted, now);
      if (now < st.holdUntil || !st.page) return;
      const out = [];
      for (const b of bindings) {
        if (!b.fn || b.t.page !== st.page) continue;
        let cmd;
        try {
          cmd = command(b, raw);
          b.error = null;
        } catch (e) {
          b.error = e.message;
          continue;
        }
        b.cmd = cmd;
        const key = `${b.t.obj}.${b.t.attr}`;
        if (st.cache.get(key) !== cmd) {
          st.cache.set(key, cmd);
          out.push(cmd);
        }
      }
      send(out);
    },
    status() {
      return {
        id: cfg.id, state: st.state, msg: st.msg, page: st.page, sent: st.sent, resets: st.resets, touch: st.touch, asleep: st.asleep === true,
        bindings: bindings.map(b => ({ value: b.value, error: b.error })),
        pages: pages.map(p => p.name),
      };
    },
  };
}
