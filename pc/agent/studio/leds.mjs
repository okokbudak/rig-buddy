// LED chain: configuration, effects and the frame renderer (WLED-style effects, game-linked bars and rules,
// colour correction). Studio renders the frames on the PC (25 Hz) and sends them to the Octopus as `LEDF <hex>`;
// the board keeps a static copy (`LED ...`) that it shows when the PC is away.
//
// A chain is split into segments. A segment paints its pixels with either
//   - an effect (look: effect + palette + speed + intensity + 3 colours), or
//   - a bar (a game value, like rpm, shown as lit pixels with a colour gradient, peak hold and blinking)
// and may carry rules: the first rule whose `when` formula is true replaces the segment's look
// (turn signal flashing, low-fuel red, brake light ...). Later segments paint over earlier ones.
import { compile } from './expr.mjs';

export const MAX_PIXELS = 64;
export const MAX_SEGMENTS = 16;
export const MAX_RULES = 8;
export const MAX_PRESETS = 24;
export const ORDERS = ['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : fb; };
const str = (v, max, fb = '') => (typeof v === 'string' ? v.slice(0, max) : fb);
const hexOk = c => /^#[0-9a-f]{6}$/i.test(String(c));
const col = (c, fb) => (hexOk(c) ? String(c).toLowerCase() : fb);
const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const frac = x => x - Math.floor(x);

// --- palettes -------------------------------------------------------------------------------------------

const STOPS = {
  rainbow: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'],
  fire: ['#000000', '#7f0000', '#ff3200', '#ffa000', '#ffff90'],
  ocean: ['#001040', '#0050a0', '#00b0d0', '#a0f0f0', '#0050a0'],
  forest: ['#003000', '#106010', '#40a030', '#a0d050', '#106010'],
  lava: ['#200000', '#a00000', '#ff4000', '#ffb000', '#ff4000', '#a00000'],
  party: ['#5500ab', '#b5004b', '#e81700', '#ab7700', '#abab00', '#dd2200', '#8f0071', '#2100d5', '#5500ab'],
  sunset: ['#000030', '#601060', '#d02050', '#ff6020', '#ffc040', '#d02050'],
  ice: ['#ffffff', '#a0e0ff', '#4080ff', '#102080', '#4080ff', '#a0e0ff'],
  cyber: ['#ff00ff', '#7000ff', '#00a0ff', '#00ffe0', '#00a0ff', '#7000ff'],
  heat: ['#000000', '#ff0000', '#ffff00', '#ffffff'],
};
export const PALETTE_IDS = ['colors', ...Object.keys(STOPS)];

/** A palette as a function x (0..1) -> [r, g, b]; evenly spaced stops, linear in between. */
function gradient(colors) {
  const rgbs = colors.map(toRgb);
  if (rgbs.length === 1) return () => rgbs[0];
  return x => {
    const f = clamp(x, 0, 1) * (rgbs.length - 1);
    const i = Math.min(rgbs.length - 2, Math.floor(f));
    const k = f - i;
    const a = rgbs[i], b = rgbs[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };
}
const PAL_FN = Object.fromEntries(Object.entries(STOPS).map(([k, v]) => [k, gradient(v)]));
const palette = (id, c1, c2, c3) => PAL_FN[id] ?? gradient([c1, c2, c3]);

// --- colour helpers -------------------------------------------------------------------------------------

const put = (b, i, rgb) => { const o = i * 3; b[o] = rgb[0]; b[o + 1] = rgb[1]; b[o + 2] = rgb[2]; };
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const fillAll = (c, rgb) => { for (let i = 0; i < c.n; i++) put(c.buf, i, rgb); };
function hsv(h, s, v) {
  h = frac(h) * 6;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
const rate = sp => 0.04 + (sp / 255) ** 2 * 3; // cycles per second for a WLED-like speed 0..255
const ph = (c, mul = 1) => frac(c.t * rate(c.sp) * mul);
const arr = (st, key, n, init = 0) => {
  if (!st[key] || st[key].length !== n) st[key] = new Float32Array(n).fill(init);
  return st[key];
};

// --- effects --------------------------------------------------------------------------------------------
// Each effect paints c.n pixels into c.buf (float rgb). c: {n, t (s), dt (s), sp, it (0..255), c1, c2, c3 (rgb),
// pal (x -> rgb), palId, st (state kept between frames), rnd ()}

const FX = {
  solid: c => fillAll(c, c.c1),
  blink: c => fillAll(c, ph(c) < 0.1 + 0.8 * c.it / 255 ? c.c1 : c.c2),
  breathe: c => fillAll(c, mix(c.c2, c.c1, 0.5 - 0.5 * Math.cos(2 * Math.PI * ph(c)))),
  fade: c => { const p = ph(c); fillAll(c, mix(c.c1, c.c2, p < 0.5 ? p * 2 : 2 - 2 * p)); },
  wipe: c => {
    const p = ph(c, 0.5), second = p >= 0.5, x = frac(p * 2) * c.n;
    for (let i = 0; i < c.n; i++) put(c.buf, i, (i < x) !== second ? c.c1 : c.c2);
  },
  scan: c => {
    const pos = (0.5 - 0.5 * Math.cos(2 * Math.PI * ph(c, 0.5))) * (c.n - 1), w = 1 + c.it / 255 * c.n / 4;
    for (let i = 0; i < c.n; i++) put(c.buf, i, mix(c.c2, c.c1, clamp(1 - Math.abs(i - pos) / w, 0, 1)));
  },
  dualscan: c => {
    const pos = (0.5 - 0.5 * Math.cos(2 * Math.PI * ph(c, 0.5))) * (c.n - 1), w = 1 + c.it / 255 * c.n / 4;
    for (let i = 0; i < c.n; i++) {
      const k = Math.max(clamp(1 - Math.abs(i - pos) / w, 0, 1), clamp(1 - Math.abs(i - (c.n - 1 - pos)) / w, 0, 1));
      put(c.buf, i, mix(c.c2, c.c1, k));
    }
  },
  larson: c => {
    const tr = arr(c.st, 'tr', c.n);
    const pos = (0.5 - 0.5 * Math.cos(2 * Math.PI * ph(c, 0.5))) * (c.n - 1), decay = Math.exp(-c.dt * (3 + (255 - c.it) / 255 * 9));
    for (let i = 0; i < c.n; i++) {
      tr[i] = Math.max(tr[i] * decay, clamp(1 - Math.abs(i - pos), 0, 1));
      put(c.buf, i, mix(c.c2, c.c1, tr[i]));
    }
  },
  comet: c => {
    const pos = ph(c) * c.n, len = 2 + c.it / 255 * c.n / 2;
    for (let i = 0; i < c.n; i++) {
      const d = (pos - i + c.n) % c.n;
      put(c.buf, i, mix(c.c2, c.c1, d < len ? (1 - d / len) ** 2 : 0));
    }
  },
  chase: c => {
    const dash = 1 + Math.round(c.it / 255 * c.n / 3), period = dash * 2, shift = Math.floor(ph(c) * period);
    for (let i = 0; i < c.n; i++) put(c.buf, i, (i + shift) % period < dash ? c.c1 : c.c2);
  },
  theater: c => {
    const shift = Math.floor(c.t * rate(c.sp) * 6);
    for (let i = 0; i < c.n; i++) put(c.buf, i, (i + shift) % 3 === 0 ? c.c1 : c.c2);
  },
  running: c => {
    const waves = 1 + c.it / 64, p = ph(c);
    for (let i = 0; i < c.n; i++) put(c.buf, i, mix(c.c2, c.c1, 0.5 + 0.5 * Math.sin(2 * Math.PI * (i / c.n * waves - p))));
  },
  rainbow: c => fillAll(c, hsv(ph(c, 0.25), 1, 1)),
  rainbowcycle: c => { const p = ph(c, 0.5); for (let i = 0; i < c.n; i++) put(c.buf, i, hsv(i / c.n - p, 1, 1)); },
  palette: c => { const p = ph(c, 0.5); for (let i = 0; i < c.n; i++) put(c.buf, i, c.pal(frac(i / c.n - p))); },
  gradient: c => { for (let i = 0; i < c.n; i++) put(c.buf, i, c.pal(c.n > 1 ? i / (c.n - 1) : 0)); },
  twinkle: c => {
    const lv = arr(c.st, 'lv', c.n), cl = arr(c.st, 'cl', c.n * 3);
    c.st.acc = (c.st.acc ?? 0) + c.n * (0.2 + c.it / 255 * 2) * c.dt;
    for (; c.st.acc >= 1; c.st.acc--) {
      const i = Math.floor(c.rnd() * c.n);
      lv[i] = 1;
      const rgb = c.palId === 'colors' ? c.c1 : c.pal(c.rnd());
      cl[i * 3] = rgb[0]; cl[i * 3 + 1] = rgb[1]; cl[i * 3 + 2] = rgb[2];
    }
    const decay = Math.exp(-c.dt * (1 + c.sp / 255 * 6));
    for (let i = 0; i < c.n; i++) { lv[i] *= decay; put(c.buf, i, mix(c.c2, [cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]], lv[i])); }
  },
  sparkle: c => {
    const s = c.st;
    if (s.pix == null || c.t >= s.next) { s.pix = Math.floor(c.rnd() * c.n); s.until = c.t + 0.06; s.next = c.t + (0.05 + c.rnd() * 0.6) / rate(c.sp) * 0.4; }
    fillAll(c, c.c2);
    if (c.t < s.until) put(c.buf, s.pix, c.c1);
  },
  strobe: c => fillAll(c, frac(c.t * rate(c.sp) * 4) < 0.12 + c.it / 255 * 0.3 ? c.c1 : c.c2),
  fire: c => {
    const n = c.n, heat = arr(c.st, 'heat', n), pal = c.palId === 'colors' ? PAL_FN.fire : c.pal;
    c.st.acc = (c.st.acc ?? 0) + c.dt * (14 + c.sp / 255 * 40);
    const cooling = 25 + (255 - c.it) / 255 * 70, sparking = 0.25 + c.it / 255 * 0.55;
    for (; c.st.acc >= 1; c.st.acc--) {
      for (let i = 0; i < n; i++) heat[i] = Math.max(0, heat[i] - c.rnd() * ((cooling * 10) / n + 2));
      for (let k = n - 1; k >= 2; k--) heat[k] = (heat[k - 1] + heat[k - 2] * 2) / 3;
      if (c.rnd() < sparking) { const y = Math.floor(c.rnd() * Math.min(7, n)); heat[y] = Math.min(255, heat[y] + 160 + c.rnd() * 95); }
    }
    for (let i = 0; i < n; i++) put(c.buf, i, pal(heat[i] / 255));
  },
  meteor: c => {
    const b = arr(c.st, 'b', c.n), pos = ph(c, 0.6) * (c.n + 6) - 3, decay = Math.exp(-c.dt * (2 + (255 - c.it) / 255 * 8));
    for (let i = 0; i < c.n; i++) {
      b[i] *= decay;
      if (Math.abs(i - pos) < 1.5) b[i] = 1;
      put(c.buf, i, mix(c.c2, c.c1, b[i]));
    }
  },
  police: c => {
    const stage = Math.floor(frac(c.t * rate(c.sp)) * 4);
    for (let i = 0; i < c.n; i++) put(c.buf, i, stage === 0 && i < c.n / 2 ? c.c1 : stage === 2 && i >= c.n / 2 ? c.c2 : [0, 0, 0]);
  },
  lightning: c => {
    const s = c.st;
    if (s.next == null) s.next = c.t + 1;
    if (c.t >= s.next) { s.start = c.t; s.flashes = 1 + Math.floor(c.rnd() * 3); s.next = c.t + (0.4 + c.rnd() * 4) * (1.3 - c.it / 255); s.level = 0.5 + c.rnd() * 0.5; }
    const e = s.start == null ? 1e9 : c.t - s.start, on = s.start != null && e < s.flashes * 0.12 && frac(e / 0.12) < 0.5;
    fillAll(c, on ? mix(c.c2, c.c1, s.level) : c.c2);
  },
  candle: c => {
    for (let i = 0; i < c.n; i++) {
      const k = 0.5 + (Math.sin(c.t * 7.1 + i * 2.3) + Math.sin(c.t * 3.7 + i * 1.1) + Math.sin(c.t * 11.3 + i * 0.7)) / 6;
      put(c.buf, i, mix(c.c2, c.c1, clamp(0.35 + 0.65 * k * (0.6 + c.it / 255 * 0.4), 0, 1)));
    }
  },
  noise: c => {
    const r = rate(c.sp);
    for (let i = 0; i < c.n; i++) {
      const v = (Math.sin(i * 0.6 + c.t * r * 2) + Math.sin(i * 0.23 - c.t * r * 2.6) + Math.sin(i * 1.1 + c.t * r * 1.4)) / 3;
      put(c.buf, i, c.pal(0.5 + 0.5 * v));
    }
  },
  ripple: c => {
    const s = c.st;
    s.rip ??= [];
    s.acc = (s.acc ?? 0) + (0.4 + c.it / 255 * 3) * c.dt;
    for (; s.acc >= 1; s.acc--) if (s.rip.length < 8) s.rip.push({ x: c.rnd() * c.n, born: c.t, col: c.palId === 'colors' ? c.c1 : c.pal(c.rnd()) });
    s.rip = s.rip.filter(r => c.t - r.born < 1.6);
    const speed = 3 + c.sp / 255 * 20;
    for (let i = 0; i < c.n; i++) {
      let v = [c.c2[0], c.c2[1], c.c2[2]];
      for (const r of s.rip) {
        const age = c.t - r.born, k = clamp(1 - Math.abs(Math.abs(i - r.x) - age * speed) / 1.5, 0, 1) * (1 - age / 1.6);
        v = [v[0] + r.col[0] * k, v[1] + r.col[1] * k, v[2] + r.col[2] * k];
      }
      put(c.buf, i, v);
    }
  },
  heartbeat: c => {
    const p = ph(c, 0.5), k = clamp(Math.exp(-(((p - 0.1) / 0.04) ** 2)) + 0.7 * Math.exp(-(((p - 0.3) / 0.05) ** 2)), 0, 1);
    fillAll(c, mix(c.c2, c.c1, k));
  },
  random: c => {
    const cl = arr(c.st, 'cl', c.n * 3);
    if (c.st.next == null || c.t >= c.st.next) {
      c.st.next = c.t + 1 / (rate(c.sp) * 3);
      for (let i = 0; i < c.n; i++) { const rgb = c.palId === 'colors' ? hsv(c.rnd(), 1, 1) : c.pal(c.rnd()); cl[i * 3] = rgb[0]; cl[i * 3 + 1] = rgb[1]; cl[i * 3 + 2] = rgb[2]; }
    }
    for (let i = 0; i < c.n; i++) put(c.buf, i, [cl[i * 3], cl[i * 3 + 1], cl[i * 3 + 2]]);
  },
  pride: c => {
    const p = ph(c, 0.3);
    for (let i = 0; i < c.n; i++) put(c.buf, i, hsv(i / c.n * 0.7 + p, 1, 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (i / c.n * 2 - p * 3)))));
  },
};

/** The effects for the editor: id, names, which controls matter. `col` = how many colours, `pal` = palette, sp/it = sliders. */
export const EFFECTS = [
  ['solid', 'Sabit renk', 'Solid', 1, 0, 0, 0],
  ['blink', 'Yanıp sön', 'Blink', 2, 0, 1, 1],
  ['breathe', 'Nefes', 'Breathe', 2, 0, 1, 0],
  ['fade', 'Geçiş', 'Fade', 2, 0, 1, 0],
  ['wipe', 'Silme', 'Color wipe', 2, 0, 1, 0],
  ['scan', 'Tarama', 'Scan', 2, 0, 1, 1],
  ['dualscan', 'Çift tarama', 'Dual scan', 2, 0, 1, 1],
  ['larson', 'Larson (KITT)', 'Larson scanner', 2, 0, 1, 1],
  ['comet', 'Kuyruklu yıldız', 'Comet', 2, 0, 1, 1],
  ['chase', 'Kovalama', 'Chase', 2, 0, 1, 1],
  ['theater', 'Tiyatro', 'Theater chase', 2, 0, 1, 0],
  ['running', 'Koşan ışıklar', 'Running lights', 2, 0, 1, 1],
  ['rainbow', 'Gökkuşağı', 'Rainbow', 0, 0, 1, 0],
  ['rainbowcycle', 'Gökkuşağı dalgası', 'Rainbow cycle', 0, 0, 1, 0],
  ['palette', 'Palet akışı', 'Palette flow', 3, 1, 1, 0],
  ['gradient', 'Gradyan', 'Gradient', 3, 1, 0, 0],
  ['twinkle', 'Pırıltı', 'Twinkle', 2, 1, 1, 1],
  ['sparkle', 'Kıvılcım', 'Sparkle', 2, 0, 1, 0],
  ['strobe', 'Strobe', 'Strobe', 2, 0, 1, 1],
  ['fire', 'Ateş', 'Fire', 0, 1, 1, 1],
  ['meteor', 'Meteor', 'Meteor', 2, 0, 1, 1],
  ['police', 'Polis', 'Police', 2, 0, 1, 0],
  ['lightning', 'Şimşek', 'Lightning', 2, 0, 0, 1],
  ['candle', 'Mum', 'Candle', 2, 0, 0, 1],
  ['noise', 'Dalga gürültüsü', 'Noise', 3, 1, 1, 0],
  ['ripple', 'Dalgalanma', 'Ripple', 2, 1, 1, 1],
  ['heartbeat', 'Kalp atışı', 'Heartbeat', 2, 0, 1, 0],
  ['random', 'Rastgele renkler', 'Random colours', 3, 1, 1, 0],
  ['pride', 'Pride', 'Pride', 0, 0, 1, 0],
].map(([id, tr, en, col, pal, sp, it]) => ({ id, tr, en, col, pal: !!pal, sp: !!sp, it: !!it }));
export const EFFECT_IDS = EFFECTS.map(e => e.id);

// --- configuration --------------------------------------------------------------------------------------

export function normalizeLook(l = {}) {
  return {
    fx: EFFECT_IDS.includes(l.fx) ? l.fx : 'solid',
    pal: PALETTE_IDS.includes(l.pal) ? l.pal : 'colors',
    speed: int(l.speed, 0, 255, 128),
    intensity: int(l.intensity, 0, 255, 128),
    c1: col(l.c1, '#ff9329'),
    c2: col(l.c2, '#000000'),
    c3: col(l.c3, '#000000'),
  };
}

const BAR_STOPS = [[0, '#00c000'], [0.7, '#ffd000'], [0.9, '#ff2000']];
export function normalizeBar(b = {}) {
  let stops = (Array.isArray(b.stops) ? b.stops : BAR_STOPS).slice(0, 6)
    .map(s => [clamp(Number(Array.isArray(s) ? s[0] : s?.pos) || 0, 0, 1), col(Array.isArray(s) ? s[1] : s?.color, '#ffffff')])
    .sort((a, z) => a[0] - z[0]);
  if (!stops.length) stops = BAR_STOPS.map(s => [...s]);
  const lo = Number(b.lo), hi = Number(b.hi);
  return {
    value: str(b.value, 300, 'x.rpmPercent'),
    lo: Number.isFinite(lo) ? lo : 0,
    hi: Number.isFinite(hi) && hi !== lo ? hi : 100,
    stops,
    bg: col(b.bg, '#000000'),
    dir: ['up', 'center', 'edges'].includes(b.dir) ? b.dir : 'up',
    peak: !!b.peak,
    blinkAbove: int(b.blinkAbove, 0, 100, 0), // % of the range: the bar flashes from there on; 0 = never
  };
}

export function normalizeSegment(s = {}, count = MAX_PIXELS) {
  const start = int(s.start, 0, count - 1, 0);
  const rules = (Array.isArray(s.rules) ? s.rules : []).slice(0, MAX_RULES).map(r => ({
    name: str(r?.name, 24), when: str(r?.when, 300), look: normalizeLook(r?.look ?? {}),
  }));
  return {
    name: str(s.name, 24),
    start,
    len: int(s.len, 1, count - start, 1),
    on: s.on !== false,
    bri: int(s.bri, 0, 255, 255),
    opacity: int(s.opacity, 0, 100, 100),
    reverse: !!s.reverse,
    mirror: !!s.mirror,
    group: int(s.group, 1, 16, 1),
    spacing: int(s.spacing, 0, 16, 0),
    mode: s.mode === 'bar' ? 'bar' : 'effect',
    look: normalizeLook(s.look ?? (s.color ? { fx: 'solid', c1: s.color } : {})), // an old segment had just a colour
    bar: normalizeBar(s.bar ?? {}),
    rules,
  };
}

const DEFAULT_SEG_LENS = [6, 6, 3, 3, 3, 3]; // the author's six strips: 18+18+9+9+9+9 LEDs = 24 ICs
export function defaultSegments(count = 24) {
  let at = 0;
  return DEFAULT_SEG_LENS.filter(len => at + len <= count).map(len => ({ name: '', start: (at += len) - len, len }));
}

export function normalizeLeds(l = {}) {
  const count = int(l.count, 1, MAX_PIXELS, 24);
  const segs = (Array.isArray(l.segments) ? l.segments : defaultSegments(count)).slice(0, MAX_SEGMENTS).map(s => normalizeSegment(s, count));
  const presets = (Array.isArray(l.presets) ? l.presets : []).slice(0, MAX_PRESETS)
    .map(p => ({ name: str(p?.name, 24), segments: (Array.isArray(p?.segments) ? p.segments : []).slice(0, MAX_SEGMENTS).map(s => normalizeSegment(s, count)) }))
    .filter(p => p.name);
  const gamma = Number(l.gamma);
  const pl = l.playlist ?? {};
  return {
    enabled: !!l.enabled,
    count,
    order: int(l.order, 0, 5, 2),
    bri: int(l.bri, 0, 255, 255),
    maxBri: int(l.maxBri, 10, 255, 255), // brightness cap (protects the supply / strips)
    gamma: Number.isFinite(gamma) ? clamp(Math.round(gamma * 10) / 10, 1, 3) : 1,
    temp: int(l.temp, -100, 100, 0), // white balance: + warmer, - cooler
    sat: int(l.sat, 0, 200, 100),
    rgb: [0, 1, 2].map(i => int(l.rgb?.[i], 0, 100, 100)), // channel scale, %
    smooth: int(l.smooth, 0, 2000, 0), // ms of crossfade between frames (0 = none)
    active: str(l.active, 24), // name of the preset loaded last (shown in the app's LED menu)
    segments: segs,
    presets,
    playlist: {
      enabled: !!pl.enabled,
      items: (Array.isArray(pl.items) ? pl.items : []).slice(0, 12).map(i => ({ preset: str(i?.preset, 24), sec: int(i?.sec, 1, 3600, 10) })),
    },
  };
}

/** The static copy the board keeps (`LED ...`): shown when the PC is away. `dark`: all off (sleep without a game). */
export function ledCommand(l, { dark = false } = {}) {
  const colorOf = s => (s.mode === 'bar' ? s.bar.stops[0][1] : s.look.c1);
  const segs = l.segments.map(s => {
    const [r, g, b] = toRgb(colorOf(s));
    return `seg=${s.start},${s.len},${r},${g},${b},${+s.on}`;
  });
  const bri = dark ? 0 : Math.round(l.bri * Math.min(l.maxBri, 255) / 255);
  return `LED n=${l.count} order=${l.order} bri=${bri} ${segs.length ? segs.join(' ') : 'clear'}`;
}

// --- rendering ------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const fnCache = new Map(); // formula text -> {fn} | {error}
function formula(expr) {
  let f = fnCache.get(expr);
  if (!f) {
    try { f = { fn: compile(expr) }; } catch (e) { f = { error: e.message }; }
    if (fnCache.size > 500) fnCache.clear();
    fnCache.set(expr, f);
  }
  return f;
}

/** Colour of a bar's gradient at position x (0..1). */
function stopColor(stops, x) {
  if (x <= stops[0][0]) return toRgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], k = b[0] === a[0] ? 1 : (x - a[0]) / (b[0] - a[0]);
      return mix(toRgb(a[1]), toRgb(b[1]), k);
    }
  }
  return toRgb(stops[stops.length - 1][1]);
}

export function createRenderer() {
  let cur = null; // smoothed output (float rgb)
  let lastT = null;
  let errors = [];
  const states = new Map(); // segment key -> effect state
  const stateOf = key => { if (!states.has(key)) states.set(key, { rnd: mulberry32(1000 + states.size * 7919) }); return states.get(key); };

  function truthy(expr, get, where) {
    if (!expr.trim()) return false;
    const f = formula(expr);
    if (f.error) { errors.push(`${where}: ${f.error}`); return false; }
    try {
      const v = f.fn(get);
      return typeof v === 'string' ? v.length > 0 : !!Number(v);
    } catch (e) { errors.push(`${where}: ${e.message}`); return false; }
  }
  function number(expr, get, where) {
    const f = formula(expr);
    if (f.error) { errors.push(`${where}: ${f.error}`); return 0; }
    try { const v = Number(f.fn(get)); return Number.isFinite(v) ? v : 0; } catch (e) { errors.push(`${where}: ${e.message}`); return 0; }
  }

  function runLook(look, n, t, dt, st) {
    const buf = new Float32Array(n * 3);
    const c1 = toRgb(look.c1), c2 = toRgb(look.c2), c3 = toRgb(look.c3);
    FX[look.fx]({ n, t, dt, sp: look.speed, it: look.intensity, c1, c2, c3, pal: palette(look.pal, look.c1, look.c2, look.c3), palId: look.pal, st, rnd: st.rnd, buf });
    return buf;
  }

  function runBar(bar, v, n, t, dt, st) {
    const buf = new Float32Array(n * 3), bg = toRgb(bar.bg);
    const lit = v * n;
    let blinkOff = false;
    if (bar.blinkAbove > 0 && v * 100 >= bar.blinkAbove) blinkOff = frac(t * 6) >= 0.5;
    const center = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      let u, f; // u: position on the gradient, f: how much of this pixel is lit
      if (bar.dir === 'up') { u = n > 1 ? i / (n - 1) : 0; f = clamp(lit - i, 0, 1); }
      else {
        const d = center > 0 ? Math.abs(i - center) / center : 0; // 0 in the middle, 1 at the ends
        const x = bar.dir === 'center' ? d : 1 - d;
        u = x; f = clamp((v - x) * n / 2 + 0.5, 0, 1);
      }
      put(buf, i, mix(bg, stopColor(bar.stops, u), blinkOff ? 0 : f));
    }
    if (bar.peak && bar.dir === 'up') {
      if (st.peak == null || v >= st.peak) { st.peak = v; st.peakAt = t; }
      else if (t - st.peakAt > 0.6) st.peak = Math.max(v, st.peak - dt * 0.5);
      const i = Math.min(n - 1, Math.round(st.peak * (n - 1)));
      if (st.peak > 0.02 && !blinkOff) put(buf, i, mix(stopColor(bar.stops, n > 1 ? i / (n - 1) : 0), [255, 255, 255], 0.6));
    }
    return buf;
  }

  /** Paints one segment into `frame` (float rgb, count pixels). */
  function paint(frame, count, seg, key, t, dt, get, where) {
    if (!seg.on || seg.opacity === 0 || seg.bri === 0) return;
    const st = stateOf(key);
    const step = seg.group + seg.spacing, vlen = Math.max(1, Math.ceil(seg.len / step));
    let look = null;
    for (let r = 0; r < seg.rules.length; r++) {
      if (truthy(seg.rules[r].when, get, `${where} rule ${r + 1}`)) { look = seg.rules[r].look; break; }
    }
    const n = seg.mirror ? Math.ceil(vlen / 2) : vlen;
    const stKey = look ? `fx:${look.fx}:${n}` : seg.mode === 'bar' ? `bar:${n}` : `fx:${seg.look.fx}:${n}`;
    if (st.key !== stKey) { const keep = st.rnd; for (const k of Object.keys(st)) delete st[k]; st.rnd = keep; st.key = stKey; }
    let buf;
    if (look) buf = runLook(look, n, t, dt, st);
    else if (seg.mode === 'bar') {
      const bar = seg.bar;
      buf = runBar(bar, clamp((number(bar.value, get, `${where} bar`) - bar.lo) / (bar.hi - bar.lo), 0, 1), n, t, dt, st);
    } else buf = runLook(seg.look, n, t, dt, st);
    // reverse, then mirror up to the full virtual length
    const idx = i => (seg.reverse ? n - 1 - i : i);
    const alpha = seg.opacity / 100, level = seg.bri / 255;
    for (let p = 0; p < seg.len; p++) {
      const vi = Math.floor(p / step);
      if (p % step >= seg.group) continue; // spacing: a gap
      let src = vi;
      if (seg.mirror) src = vi < n ? vi : vlen - 1 - vi;
      src = idx(clamp(src, 0, n - 1));
      const g = (seg.start + p) * 3;
      if (g >= count * 3) break;
      for (let q = 0; q < 3; q++) frame[g + q] = frame[g + q] * (1 - alpha) + buf[src * 3 + q] * level * alpha;
    }
  }

  /** Colour correction for one pixel (float rgb 0..255 in, 0..255 out). */
  function correct(cfg, lut) {
    const k = clamp(cfg.temp / 100, -1, 1);
    const wb = k >= 0 ? [1, 1 - 0.22 * k, 1 - 0.6 * k] : [1 + 0.4 * k, 1 + 0.1 * k, 1];
    const mul = [wb[0] * cfg.rgb[0] / 100, wb[1] * cfg.rgb[1] / 100, wb[2] * cfg.rgb[2] / 100];
    const sat = cfg.sat / 100, bri = Math.min(cfg.bri, cfg.maxBri) / 255;
    return px => {
      const gray = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      const out = [0, 0, 0];
      for (let q = 0; q < 3; q++) {
        const v = clamp((gray + (px[q] - gray) * sat) * mul[q], 0, 255);
        out[q] = lut[Math.round(v)] * bri;
      }
      return out;
    };
  }

  const lutCache = new Map();
  const gammaLut = g => {
    if (!lutCache.has(g)) lutCache.set(g, Float32Array.from({ length: 256 }, (_, i) => 255 * (i / 255) ** g));
    return lutCache.get(g);
  };

  return {
    /** Error messages of the last frame (formulas that did not compile or failed). */
    get errors() { return errors; },
    /**
     * One frame. `get(path)` reads telemetry for the formulas; `awake` false = the chain is dark (no game, sleep).
     * Returns Uint8Array(count * 3) in logical RGB order (the board reorders the channels).
     */
    render(cfg, now, get, { awake = true } = {}) {
      errors = [];
      const t = now / 1000, dt = lastT == null ? 0.04 : clamp(t - lastT, 0.001, 0.25);
      lastT = t;
      const count = cfg.count;
      if (!cur || cur.length !== count * 3) cur = new Float32Array(count * 3);
      const target = new Float32Array(count * 3);
      if (awake) {
        let segs = cfg.segments, sk = 'main';
        if (cfg.playlist.enabled && cfg.playlist.items.length) {
          const total = cfg.playlist.items.reduce((a, i) => a + i.sec, 0);
          let x = t % total, item = cfg.playlist.items[0];
          for (const i of cfg.playlist.items) { if (x < i.sec) { item = i; break; } x -= i.sec; }
          const preset = cfg.presets.find(p => p.name === item.preset);
          if (preset) { segs = preset.segments; sk = `pl:${preset.name}`; }
        }
        const frame = new Float32Array(count * 3);
        segs.forEach((seg, i) => paint(frame, count, seg, `${sk}:${i}`, t, dt, get, seg.name || `segment ${i + 1}`));
        const fix = correct(cfg, gammaLut(cfg.gamma));
        for (let i = 0; i < count; i++) {
          const o = fix([frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2]]);
          target[i * 3] = o[0]; target[i * 3 + 1] = o[1]; target[i * 3 + 2] = o[2];
        }
      }
      const a = cfg.smooth > 0 ? 1 - Math.exp(-dt * 1000 / cfg.smooth) : 1;
      const out = new Uint8Array(count * 3);
      for (let i = 0; i < count * 3; i++) {
        cur[i] += (target[i] - cur[i]) * a;
        out[i] = Math.round(clamp(cur[i], 0, 255));
      }
      return out;
    },
  };
}

export const frameHex = u8 => Buffer.from(u8).toString('hex');
