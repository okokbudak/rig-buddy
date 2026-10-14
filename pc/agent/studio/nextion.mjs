// Nextion displays: what SimHub's Nextion plugin did.
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
// Connection: its own COM port, or `via` a serial device whose board passes the display
// through (the Octopus gauge board: "@<command>\n" out, "@<hex of the frame>\n" back);
// the engine picks the transport, this module only produces commands and reads frames.
import { compile, FormulaError } from './expr.mjs';
import { read } from './props.mjs';

const FF3 = Buffer.from([0xff, 0xff, 0xff]);
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 512000, 921600];
const PAGE_SETTLE_MS = 150; // a display needs a moment to load a page before it takes commands
const TOUCH_DEBOUNCE_MS = 350;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const ATTR = /^[a-z][a-z0-9]{0,15}$/;
const ACTIONS = /^(next|prev|page:[A-Za-z][A-Za-z0-9_]{0,23})$/;

const KINDS = ['text', 'bar', 'lamp'];
const ALIGN = { l: 0, c: 1, r: 2 };

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
      .map(p => ({
        name: str(p.name, 24), rotation: !!p.rotation, showWhen: str(p.showWhen, 500),
        // pictures of a page drawn by widgets: its background, and the same page with every lamp lit
        pic: Number.isInteger(p.pic) ? num(p.pic, 0, 255, null) : null,
        litPic: Number.isInteger(p.litPic) ? num(p.litPic, 0, 255, null) : null,
      }))
      .filter(p => NAME.test(p.name));
    out.push({
      id,
      name: str(d.name, 40, id),
      enabled: !!d.enabled,
      port: /^COM\d{1,3}$/.test(port) ? port : '',
      via: str(d.via, 32).toLowerCase().replace(/[^a-z0-9_-]/g, ''),
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
      // text sent to the display: latin1 (ISO-8859-1) or latin5 (ISO-8859-9, Turkish) - must match the fonts
      encoding: d.encoding === 'latin5' ? 'latin5' : 'latin1',
      widgets: (Array.isArray(d.widgets) ? d.widgets.slice(0, 400) : []).map(w => ({
        page: str(w.page, 24),
        k: KINDS.includes(w.k) ? w.k : 'text',
        id: str(w.id, 32),
        x: num(w.x, 0, 2000, 0), y: num(w.y, 0, 2000, 0), w: num(w.w, 1, 2000, 10), h: num(w.h, 1, 2000, 10),
        font: num(w.font, 0, 255, 0),
        color: str(w.color, 500, '#FFFFFF'),
        align: w.align in ALIGN ? w.align : 'l',
        crop: w.crop === 'lit' ? 'lit' : 'bg',
        show: str(w.show, 500),
        expr: str(w.expr, 800),
      })).filter(w => NAME.test(w.page)),
    });
  }
  return out;
}

/** Own COM port: each command followed by FF FF FF. */
export function directFrames(cmds) {
  const parts = [];
  for (const c of cmds) parts.push(Buffer.from(c, 'latin1'), FF3);
  return Buffer.concat(parts);
}

/** Through a pass-through board: one "@<command>" text line per command (commands never contain a newline). */
export function tunnelLines(cmds) {
  return Buffer.from(cmds.map(c => `@${c}\n`).join(''), 'latin1');
}

/** A "@<hex>" line from a pass-through board -> the display's frame bytes, with FF FF FF; null for anything else. */
export function tunnelFrame(text) {
  const m = /^@((?:[0-9A-Fa-f]{2})*)\s*$/.exec(String(text));
  return m ? Buffer.concat([Buffer.from(m[1], 'hex'), FF3]) : null;
}

/** "page1.tgear.txt" -> {page, obj, attr}; null when it is not a valid target. */
export function parseTarget(target) {
  const m = /^([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\.([a-z][a-z0-9]*)$/.exec(target);
  return m && ATTR.test(m[3]) ? { page: m[1], obj: m[2], attr: m[3] } : null;
}

// ISO-8859-9 puts the six Turkish letters where ISO-8859-1 has Ð ð Ý ý Þ þ
const LATIN5 = { 'Ğ': '\u00d0', 'ğ': '\u00f0', 'İ': '\u00dd', 'ı': '\u00fd', 'Ş': '\u00de', 'ş': '\u00fe' };

function formatText(v, decimals, encoding = 'latin1') {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '0';
    if (decimals != null) return v.toFixed(decimals);
    return Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  }
  let s = String(v).replace(/[\u0000-\u001f"\\]/g, ' ');
  if (encoding === 'latin5') s = s.replace(/[ĞğİıŞş]/g, ch => LATIN5[ch]);
  return s.replace(/[^\u0020-\u00ff]/g, '?'); // each char is now one byte (sent as latin1)
}

/** '#RRGGBB' (or a number) -> the display's 16-bit RGB565 colour. */
export function rgb565(c) {
  if (typeof c === 'number' && Number.isFinite(c)) return Math.max(0, Math.min(65535, Math.round(c)));
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c ?? '').trim());
  if (!m) return 65535;
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `out(commands)` delivers a batch of commands (strings without FF FF FF) to the display. */
export function createNextion(cfg, { out }) {
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
  const pageByName = new Map(pages.map(p => [p.name, p]));
  // widgets: drawn by the display's own drawing commands over the page picture (no components needed)
  const tryCompile = src => {
    try { return { fn: compile(src), error: null }; } catch (e) { return { fn: null, error: e.message }; }
  };
  const widgets = cfg.widgets.map(w => {
    const e = tryCompile(w.expr || "''");
    const color = /^#[0-9a-f]{6}$/i.test(w.color.trim()) ? { fn: () => w.color.trim(), error: null } : tryCompile(w.color);
    const show = w.show.trim() ? tryCompile(w.show) : { fn: () => true, error: null };
    return { ...w, fn: e.fn, colorFn: color.fn, showFn: show.fn, error: e.error ?? color.error ?? show.error, value: '', cmd: '' };
  });
  const rotation = pages.filter(p => p.rotation).map(p => p.name);

  const st = {
    state: 'off', msg: '', page: '', userPage: 0, sent: 0, touch: '', asleep: null,
    cache: new Map(), resets: 0, holdUntil: 0, lastTouchAt: 0, rx: Buffer.alloc(0),
  };

  const send = cmds => {
    if (!cmds.length) return;
    out(cmds);
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
      b.value = formatText(v, b.decimals, cfg.encoding);
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

  /** The drawing command(s) of one widget for the current values. */
  function drawWidget(w, get) {
    const p = pageByName.get(w.page);
    const bgPic = p?.pic ?? 0;
    const litPic = p?.litPic ?? bgPic;
    const { x, y, w: wd, h } = w;
    const blank = `xpic ${x},${y},${wd},${h},${x},${y},${bgPic}`; // the page's own background over the widget
    if (w.k === 'lamp') {
      const on = !!w.fn(get);
      w.value = on ? '1' : '0';
      return `xpic ${x},${y},${wd},${h},${x},${y},${on ? litPic : bgPic}`;
    }
    if (w.k === 'bar') {
      const v = Number(w.fn(get));
      const pct = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
      const fw = Math.round((wd * pct) / 100);
      w.value = String(Math.round(pct));
      const color = rgb565(w.colorFn(get));
      const parts = [];
      if (fw > 0) parts.push(`fill ${x},${y},${fw},${h},${color}`);
      if (fw < wd) parts.push(`xpic ${x + fw},${y},${wd - fw},${h},${x + fw},${y},${bgPic}`);
      return parts.join('\u0000'); // several commands, split when sent
    }
    if (!w.showFn(get)) {
      w.value = '';
      return blank;
    }
    w.value = formatText(w.fn(get), null, cfg.encoding);
    const cropPic = w.crop === 'lit' ? litPic : bgPic;
    // xstr x,y,w,h,font,colour,background picture,xcenter,ycenter,0 = crop the background from that picture
    return `xstr ${x},${y},${wd},${h},${w.font},${rgb565(w.colorFn(get))},${cropPic},${ALIGN[w.align]},1,0,"${w.value}"`;
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
      // widgets, in their order: one that is redrawn paints over the ones after it that it overlaps,
      // so those are drawn again (a speed-limit sign, then the number on it)
      const redrawn = [];
      const get = p => read(raw, p);
      for (const [i, w] of widgets.entries()) {
        if (!w.fn || w.page !== st.page) continue;
        let cmd;
        try {
          cmd = drawWidget(w, get);
          w.error = null;
        } catch (e) {
          w.error = e.message;
          continue;
        }
        w.cmd = cmd;
        const key = `w${i}`;
        if (st.cache.get(key) !== cmd || redrawn.some(r => overlaps(r, w))) {
          st.cache.set(key, cmd);
          out.push(...cmd.split('\u0000'));
          redrawn.push(w);
        }
      }
      send(out);
    },
    status() {
      return {
        id: cfg.id, state: st.state, msg: st.msg, page: st.page, sent: st.sent, resets: st.resets, touch: st.touch, asleep: st.asleep === true,
        bindings: bindings.map(b => ({ value: b.value, error: b.error })),
        widgets: widgets.map(w => ({ value: w.value, error: w.error })),
        pages: pages.map(p => p.name),
      };
    },
  };
}
