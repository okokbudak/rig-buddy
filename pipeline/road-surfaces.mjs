// Builds the map's road tarmac - roads and junctions - from the game's own data, in
// game metres, and projects it to longitude / latitude only at the end.
//
//   roads      every road item (not the map's merged lines): its spline through the two
//              nodes (cubic Hermite, tangent = the road's own length, which reproduces the
//              game's length to 0.1 % on 88 % of roads), and the lane blocks of its look.
//   junctions  every lane curve of every prefab, as a strip one lane wide.
//
// Where the lanes lie is not assumed from the look files: `offset` means "inner edge of the
// carriageway" in some looks and "centre of the carriageway" in others, and one-way roads
// with an odd number of lanes sit half a lane off the centre. So the build LEARNS, for each
// look, where its lane block(s) sit from the lane curves the game starts at the ends of
// roads of that look (they begin exactly on the lane centres), and lane width the same way.
// A road ribbon then ends exactly where the junction strips begin: same edges, same width,
// same colour, nothing sticking out.
//
// usage: node road-surfaces.mjs --game ets2|ats --parser <parser dir> --curves <prefab-curves.geojson>
//                               --lines <map lines .geojson> --out <surfaces.geojson>
//                               [--fit-out <looks.json>] [--near x,y,radius]   (last one: game metres, for testing)
import fs from 'node:fs';
import path from 'node:path';
import { makeProjection } from './projection.mjs';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const GAME = opt('--game') ?? 'ets2';
const MAP = GAME === 'ats' ? 'usa' : 'europe';
const PARSER = opt('--parser');
const CURVES = opt('--curves');
const LINES = opt('--lines');
const OUT = opt('--out');
const FIT_OUT = opt('--fit-out');
const NEAR = opt('--near')?.split(',').map(Number);
const DEBUG_AT = opt('--debug-at')?.split(',').map(Number);      // lon,lat: explain every curve within 15 m (testing)
if (!PARSER || !CURVES || !LINES || !OUT) {
  console.error('usage: road-surfaces.mjs --game ets2|ats --parser <dir> --curves <file> --lines <file> --out <file>');
  process.exit(2);
}
const proj = makeProjection(GAME);
const t0 = Date.now();
const log = msg => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)} s] ${msg}`);
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const TOL = 0.06;            // how exactly a lane curve has to start on a lane centre (game m)
const EXT = 0.25;            // ends run this far into the next piece, so no hairline shows between them
const NEAR_END = 0.3;        // a curve end counts as "at the road end" within this distance along the road
const PITCHES = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

// --- look files -----------------------------------------------------------------------------
const looks = new Map();
{
  const raw = read(path.join(PARSER, `${MAP}-roadLooks.json`));
  for (const l of Array.isArray(raw) ? raw : Object.values(raw)) looks.set(l.token, l);
}
/** What the style needs to know about a look. */
function roadTypeOf(look) {
  const lanes = look.lanesLeft.concat(look.lanesRight);
  if (!lanes.length) return 'local';
  if (lanes.some(l => l.includes('freeway') || l.includes('motorway'))) return 'freeway';
  if (lanes.some(l => l.includes('divided') || l.includes('expressway'))) return 'divided';
  if (lanes.some(l => ['local', 'no_vehicles', 'side_road', 'slow_road'].some(t => l.includes(t)))) return 'local';
  if (lanes.some(l => l.includes('tram'))) return 'tram';
  if (lanes.some(l => l.includes('train'))) return 'train';
  return 'unknown';
}
/** Lane width the look most likely has, before the curves confirm it. */
function defaultPitch(look) {
  const t = `${look.lanesLeft[0] ?? ''} ${look.lanesRight[0] ?? ''}`;
  if (t.includes('no_vehicles')) return 2.5;
  if (t.includes('narrow') || t.includes('dust')) return 3.5;
  return 4.5;
}

// --- game data ------------------------------------------------------------------------------
log('reading roads, nodes and looks');
const roads = read(path.join(PARSER, `${MAP}-roads.json`));
const nodes = new Map();
for (const n of read(path.join(PARSER, `${MAP}-nodes.json`))) nodes.set(n.uid, { x: n.x, y: n.y, z: n.z, rot: n.rotation });
log(`${roads.length} roads, ${nodes.size} nodes, ${looks.size} looks`);

// --- lane curves, in game coordinates ---------------------------------------------------------
log('reading the prefab lane curves');
const curves = [];              // { pts: [[x,y],...] }
{
  const gj = read(CURVES);
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    for (const c of g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) {
      if (c.length < 2) continue;
      curves.push({ pts: c.map(p => proj.toGame(p[0], p[1])) });
    }
  }
}
log(`${curves.length} lane curves`);

const CELL = 30;
const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
const endGrid = new Map();
for (const c of curves) for (const p of [c.pts[0], c.pts[c.pts.length - 1]]) {
  const k = cellKey(p[0], p[1]);
  if (!endGrid.has(k)) endGrid.set(k, []);
  endGrid.get(k).push(p);
}

/** Lateral positions (game m, + = left of travel) of the lane-curve ends sitting on a road end. */
function lanesAt(node) {
  const tx = Math.cos(node.rot), ty = Math.sin(node.rot), nx = -ty, ny = tx;
  const kx = Math.floor(node.x / CELL), ky = Math.floor(node.y / CELL);
  const out = new Set();
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of endGrid.get(`${kx + a},${ky + b}`) ?? []) {
    const dx = q[0] - node.x, dy = q[1] - node.y;
    if (Math.abs(dx * tx + dy * ty) < NEAR_END) { const lat = dx * nx + dy * ny; if (Math.abs(lat) < 40) out.add(+lat.toFixed(3)); }
  }
  return [...out];
}

// --- learn where each look's lanes lie ---------------------------------------------------------
log('learning lane blocks per road look');
const laneTypeOf = (look, slot) => (slot === 'right' ? look.lanesRight[0] : slot === 'left' ? look.lanesLeft[0] : (look.lanesLeft[0] ?? look.lanesRight[0])) ?? '';
/**
 * Every (pitch, centre) that puts a block of n >= 2 lanes exactly on observed lane centres:
 * the pitch is the distance between two observed lanes, so it is exact whatever the width
 * (ETS2 lanes are 4.5, 3.5 or 2.5 m, ATS's are narrower), and the rest of the block has to be there too.
 */
function fitBlock(n, U) {
  const out = [];
  const sorted = U.slice().sort((x, y) => x - y);
  const seen = new Set();
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const p = sorted[j] - sorted[i];
    if (p < 1.8 || p > 5.6) continue;
    for (let k = 0; k < n; k++) {             // sorted[i] is lane k of the block
      const first = sorted[i] - k * p;
      let all = true;
      for (let m = 0; m < n && all; m++) { const t = first + m * p; if (!sorted.some(v => Math.abs(v - t) < TOL)) all = false; }
      if (!all) continue;
      const pr = Math.round(p / 0.05) * 0.05, c = first + ((n - 1) / 2) * p;
      const id = pr.toFixed(2) + '|' + Math.round(c / 0.05);
      if (seen.has(id)) continue; seen.add(id);
      out.push([+pr.toFixed(2), c]);
    }
  }
  return out;
}
const votes = new Map();       // token -> { plain|left|right: Map(key -> {n, p, sum}) }
const endsSeen = new Map();    // token -> road ends that have lane curves on them
const vote = (token, slot, p, c) => {
  const v = votes.get(token) ?? {};
  const m = (v[slot] ??= new Map());
  const key = p + '|' + Math.round(c / 0.05);
  const e = m.get(key) ?? { n: 0, p, sum: 0 };
  e.n++; e.sum += c;
  m.set(key, e);
  votes.set(token, v);
};
for (const r of roads) {
  const look = looks.get(r.roadLookToken);
  if (!look) continue;
  const L = look.lanesLeft.length, R = look.lanesRight.length, n = L + R;
  if (!n) continue;
  const o = look.offset ?? 0;
  for (const uid of [r.startNodeUid, r.endNodeUid]) {
    const node = nodes.get(uid);
    if (!node) continue;
    const U = lanesAt(node);
    if (!U.length) continue;
    endsSeen.set(r.roadLookToken, (endsSeen.get(r.roadLookToken) ?? 0) + 1);
    const block = (slot, count, values) => {
      if (count === 1) { for (const u of values) vote(r.roadLookToken, slot, 0, u); }
      else for (const [p, c] of fitBlock(count, values)) vote(r.roadLookToken, slot, p, c);
    };
    // one block of n lanes, or - a median or a centre turn lane between them - two blocks
    block('plain', n, U);
    if (L && R) { block('left', L, U.filter(u => u > 0)); block('right', R, U.filter(u => u < 0)); }
  }
}
/** The winning (pitch, centre) of a slot, or null without enough evidence. */
const winner = m => {
  let best = null;
  if (m) for (const e of m.values()) if (!best || e.n > best.n) best = e;
  return best && best.n >= 3 ? { p: best.p, c: best.sum / best.n, n: best.n } : null;
};
// lane width by lane type, from every block of two or more lanes: single lanes and looks with no
// junction to learn from take it
const pitchesByType = new Map();
for (const [token, v] of votes) {
  const look = looks.get(token);
  for (const slot of ['plain', 'left', 'right']) {
    const w = winner(v[slot]);
    if (!w || !w.p) continue;
    const t = laneTypeOf(look, slot);
    (pitchesByType.get(t) ?? pitchesByType.set(t, []).get(t)).push([w.p, w.n]);
  }
}
const typePitch = new Map();
for (const [t, arr] of pitchesByType) {
  const cnt = new Map();
  for (const [p, n] of arr) cnt.set(p, (cnt.get(p) ?? 0) + n);
  typePitch.set(t, [...cnt.entries()].sort((x, y) => y[1] - x[1])[0][0]);
}
const pitchFor = (look, slot) => typePitch.get(laneTypeOf(look, slot)) ?? defaultPitch(look);
log('lane width by lane type: ' + [...typePitch].sort().map(([t, p]) => t.replace('traffic_lane.', '') + ' ' + p).join(', '));

/** The look's lane blocks as [{ lo, hi, n, pitch, centre }] in the road's own frame (+ = left of travel). */
const blocksOf = new Map();
const status = new Map();          // look token -> 'learned' | 'guessed'
let learned = 0, guessed = 0;
for (const [token, look] of looks) {
  const L = look.lanesLeft.length, R = look.lanesRight.length, n = L + R;
  if (!n) { blocksOf.set(token, []); continue; }
  const o = look.offset ?? 0;
  const v = votes.get(token) ?? {};
  const make = (slot, count, fallbackCentre) => {
    const w = winner(v[slot]);
    const dp = pitchFor(look, slot);
    if (w) {
      learned++; if (status.get(token) !== 'guessed') status.set(token, 'learned');
      return { c: w.c, p: w.p || dp, n: count };
    }
    guessed++; status.set(token, 'guessed');
    return { c: fallbackCentre(dp), p: dp, n: count };
  };
  const ends = endsSeen.get(token) ?? 0;
  const plainW = winner(v.plain), leftW = winner(v.left), rightW = winner(v.right);
  const fracPlain = plainW && ends ? plainW.n / ends : 0;
  const fracSplit = L && R && leftW && rightW && ends ? Math.min(leftW.n, rightW.n) / ends : 0;
  const blocks = [];
  if (!L || !R) {
    blocks.push(make('plain', n, p => (n % 2 === 0 ? 0 : (L % 2 === 0 ? -p / 2 : p / 2))));
  } else if (fracSplit > fracPlain + 0.05 || (!plainW && fracSplit > 0)) {
    blocks.push(make('left', L, p => o + (L * p) / 2), make('right', R, p => -(o + (R * p) / 2)));
  } else if (plainW) {
    blocks.push(make('plain', n, p => (n % 2 === 0 ? 0 : (L % 2 === 0 ? -p / 2 : p / 2))));
  } else if (o > 0) {
    // no junction to learn from: the inner lane edge at the offset (what the looks with a small offset show)
    blocks.push(make('left', L, p => o + (L * p) / 2), make('right', R, p => -(o + (R * p) / 2)));
  } else {
    blocks.push(make('plain', n, p => (n % 2 === 0 ? 0 : (L % 2 === 0 ? -p / 2 : p / 2))));
  }
  // a centre turn lane (ATS "2-1-2") is not in the look's lane lists but is tarmac: when the gap
  // between the two blocks is exactly one lane wide, fill it. A real median is never that wide.
  if (blocks.length === 2) {
    const lo = blocks[1], hi = blocks[0];       // right block (-) and left block (+)
    const gap = (hi.c - (hi.n * hi.p) / 2) - (lo.c + (lo.n * lo.p) / 2);
    if (Math.abs(gap - hi.p) < 0.15) {
      const c = ((hi.c + (hi.n * hi.p) / 2) + (lo.c - (lo.n * lo.p) / 2)) / 2, w = (hi.c + (hi.n * hi.p) / 2) - (lo.c - (lo.n * lo.p) / 2);
      blocks.length = 0;
      blocks.push({ c, p: hi.p, n: Math.round(w / hi.p) });
    }
  }
  blocksOf.set(token, blocks.map(b => ({ lo: b.c - (b.n * b.p) / 2, hi: b.c + (b.n * b.p) / 2, n: b.n, pitch: b.p, centre: b.c })));
}
log(`${learned} lane blocks learned from the game's lane curves, ${guessed} guessed (no junction to learn from)`);
if (FIT_OUT) fs.writeFileSync(FIT_OUT, JSON.stringify(Object.fromEntries([...blocksOf].map(([t, b]) => [t, { name: looks.get(t)?.name, blocks: b }]))));

// --- road ribbons ---------------------------------------------------------------------------
log('building road ribbons');
const features = [];             // { z, f }
const laneEnds = new Map();      // grid of road-end lane centres: where junction strips attach
const laneKey = (x, y) => `${Math.floor(x / 4)},${Math.floor(y / 4)}`;
const inNear = (x, y) => !NEAR || Math.hypot(x - NEAR[0], y - NEAR[1]) <= NEAR[2];

function hermiteAt(a, b, len, t) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const s = (len > 0 ? len : dist);
  const m0x = Math.cos(a.rot) * s, m0y = Math.sin(a.rot) * s, m1x = Math.cos(b.rot) * s, m1y = Math.sin(b.rot) * s;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d01 = -6 * t2 + 6 * t, d11 = 3 * t2 - 2 * t;
  const x = h00 * a.x + h10 * m0x + h01 * b.x + h11 * m1x, y = h00 * a.y + h10 * m0y + h01 * b.y + h11 * m1y;
  let dx = d00 * a.x + d10 * m0x + d01 * b.x + d11 * m1x, dy = d00 * a.y + d10 * m0y + d01 * b.y + d11 * m1y;
  const dl = Math.hypot(dx, dy) || 1;
  return [x, y, dx / dl, dy / dl];
}
// 6 decimals of a degree is 0.1 m on the map, well under a hundredth of a game metre
const toRing = pts => {
  const r = pts.map(p => { const q = proj.toLonLat(p[0], p[1]); return [Math.round(q[0] * 1e6) / 1e6, Math.round(q[1] * 1e6) / 1e6]; });
  r.push(r[0]);
  return r;
};

let ribbons = 0, skipped = 0;
const guessedRoads = new Map();
for (const r of roads) {
  const look = looks.get(r.roadLookToken);
  const a = nodes.get(r.startNodeUid), b = nodes.get(r.endNodeUid);
  if (!look || !a || !b) { skipped++; continue; }
  const type = roadTypeOf(look);
  if (type === 'train') continue;
  const blocks = blocksOf.get(r.roadLookToken);
  if (!blocks.length) { skipped++; continue; }
  if (!inNear((a.x + b.x) / 2, (a.y + b.y) / 2)) continue;
  if (status.get(r.roadLookToken) === 'guessed') guessedRoads.set(r.roadLookToken, (guessedRoads.get(r.roadLookToken) ?? 0) + 1);
  const z = Math.max(a.z ?? 0, b.z ?? 0);
  const props = { type: 'road', roadType: type, hidden: r.hidden === true };
  const len = r.length > 0 ? r.length : Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(3, Math.min(80, Math.ceil(len / 8)));
  const spline = [];
  for (let i = 0; i <= steps; i++) spline.push(hermiteAt(a, b, r.length, i / steps));
  for (const blk of blocks) {
    const left = [], right = [];
    for (let i = 0; i <= steps; i++) {
      let [x, y, tx, ty] = spline[i];
      if (i === 0) { x -= tx * EXT; y -= ty * EXT; }
      if (i === steps) { x += tx * EXT; y += ty * EXT; }
      const nx = -ty, ny = tx;
      left.push([x + nx * blk.hi, y + ny * blk.hi]);
      right.push([x + nx * blk.lo, y + ny * blk.lo]);
    }
    features.push({ z, f: { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [toRing([...left, ...right.reverse()])] } } });
    ribbons++;
  }
  // where this road's lanes end: junction strips attach here
  for (const [node, sgn] of [[a, -1], [b, 1]]) {
    const nx = -Math.sin(node.rot), ny = Math.cos(node.rot);
    const out = [Math.cos(node.rot) * sgn, Math.sin(node.rot) * sgn];   // out of the road, into the junction
    for (const blk of blocks) for (let j = 0; j < blk.n; j++) {
      const c = blk.centre + (j - (blk.n - 1) / 2) * blk.pitch;
      const x = node.x + nx * c, y = node.y + ny * c;
      const k = laneKey(x, y);
      if (!laneEnds.has(k)) laneEnds.set(k, []);
      laneEnds.get(k).push({ x, y, pitch: blk.pitch, props, z: node.z ?? 0, out });
    }
  }
}
log(`${ribbons} road ribbons (${skipped} roads skipped: looks without lanes - sidewalks, rails, footpaths)`);
{
  const total = [...guessedRoads.values()].reduce((x, y) => x + y, 0);
  log(`roads on a look whose lanes were guessed, not learned: ${total}`);
  for (const [t, n] of [...guessedRoads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    const l = looks.get(t);
    log(`   ${String(n).padStart(6)}  ${t} L${l.lanesLeft.length} R${l.lanesRight.length} offset ${l.offset ?? 0} "${l.name}"`);
  }
}

// --- junction strips ---------------------------------------------------------------------------
log('building junction strips');
/** The road-end lane a curve end sits on (within 0.3 m), or null. */
function laneAtEnd(p) {
  const kx = Math.floor(p[0] / 4), ky = Math.floor(p[1] / 4);
  let best = null, bd = 0.3;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const e of laneEnds.get(`${kx + a},${ky + b}`) ?? []) {
    const d = Math.hypot(e.x - p[0], e.y - p[1]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let bi = -1, bd = tol;
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1, dl = Math.hypot(dx, dy) || 1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - x1) * dy - (pts[k][1] - y1) * dx) / dl;
      if (d > bd) { bd = d; bi = k; }
    }
    if (bi >= 0) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const DEDUPE_CELL = 1.0;
const covered = new Map();
const cKey = (x, y) => `${Math.floor(x / DEDUPE_CELL)},${Math.floor(y / DEDUPE_CELL)}`;
function coveredAt(x, y, who) {
  const kx = Math.floor(x / DEDUPE_CELL), ky = Math.floor(y / DEDUPE_CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of covered.get(`${kx + a},${ky + b}`) ?? []) {
    if (Math.abs(q[0] - x) < 0.5 && Math.abs(q[1] - y) < 0.5) { if (who) who.push(q); return true; }
  }
  return false;
}
function resample(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], seg = Math.hypot(dx, dy);
    let d = step - acc;
    while (d < seg) { const t = d / seg; out.push([pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t]); d += step; }
    acc = seg - (d - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** A strip along `pts` whose half-width slides from h0 at the start to h1 at the end; flat ends. */
function strip(pts, h0, h1) {
  const n = pts.length;
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy);
    if (l === 0) return null;
    seg.push([dx / l, dy / l]);
  }
  // run a little past both ends, into the road it joins
  const P = pts.map(p => [p[0], p[1]]);
  P[0] = [P[0][0] - seg[0][0] * EXT, P[0][1] - seg[0][1] * EXT];
  P[n - 1] = [P[n - 1][0] + seg[n - 2][0] * EXT, P[n - 1][1] + seg[n - 2][1] * EXT];
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const h = h0 + ((h1 - h0) * i) / (n - 1);
    const s0 = seg[Math.max(0, i - 1)], s1 = seg[Math.min(n - 2, i)];
    const n0 = [-s0[1], s0[0]], n1 = [-s1[1], s1[0]];
    let mx = n0[0] + n1[0], my = n0[1] + n1[1];
    const ml = Math.hypot(mx, my);
    if (ml > 1.2) {
      const sc = (2 / ml) * h;
      left.push([P[i][0] + (mx / 2) * sc, P[i][1] + (my / 2) * sc]);
      right.push([P[i][0] - (mx / 2) * sc, P[i][1] - (my / 2) * sc]);
    } else {
      left.push([P[i][0] + n0[0] * h, P[i][1] + n0[1] * h], [P[i][0] + n1[0] * h, P[i][1] + n1[1] * h]);
      right.push([P[i][0] - n0[0] * h, P[i][1] - n0[1] * h], [P[i][0] - n1[0] * h, P[i][1] - n1[1] * h]);
    }
  }
  return [...left, ...right.reverse()];
}
let strips = 0, dropped = 0, attached = 0;
const angles = [];           // angle between a lane curve and the road it starts on (degrees)
const dflt = { props: { type: 'road', roadType: 'local', hidden: false }, pitch: 4.5, z: 0 };
for (const c of curves) {
  const first = c.pts[0], last = c.pts[c.pts.length - 1];
  if (!inNear(first[0], first[1])) continue;
  const A = laneAtEnd(first), B = laneAtEnd(last);
  const dbg = DEBUG_AT && c.pts.some(p => { const g = proj.toGame(DEBUG_AT[0], DEBUG_AT[1]); return Math.hypot(p[0] - g[0], p[1] - g[1]) < 15; });
  if (A || B) attached++;
  if (A) { const d = [c.pts[1][0] - first[0], c.pts[1][1] - first[1]], l = Math.hypot(d[0], d[1]) || 1; angles.push((Math.acos(Math.max(-1, Math.min(1, (d[0] * A.out[0] + d[1] * A.out[1]) / l))) * 180) / Math.PI); }
  if (B) { const q = c.pts[c.pts.length - 2], d = [q[0] - last[0], q[1] - last[1]], l = Math.hypot(d[0], d[1]) || 1; angles.push((Math.acos(Math.max(-1, Math.min(1, (d[0] * B.out[0] + d[1] * B.out[1]) / l))) * 180) / Math.PI); }
  const pts = c.pts;
  // The same lane path is listed once per turn it can lead to, and turns from one lane share
  // their first metres: draw only the part of each curve that is not tarmac yet.
  const samples = resample(pts, 0.75);
  const whoCovers = [];
  const isCovered = samples.map(p => { const w = []; const r = coveredAt(p[0], p[1], dbg ? w : null); whoCovers.push(w[0]); return r; });
  const src = A ?? B ?? dflt;
  const zHere = Math.max(A?.z ?? -1e9, B?.z ?? -1e9);
  let any = false;
  if (dbg) {
    console.log(`curve ${c.pts.length} pts, ${samples.length} samples, start ${first.map(v => v.toFixed(1))} end ${last.map(v => v.toFixed(1))}  A=${A ? A.pitch + ' ' + A.props.roadType : '-'} B=${B ? B.pitch + ' ' + B.props.roadType : '-'}  covered ${isCovered.map(x => (x ? '1' : '0')).join('')}`);
    const who = whoCovers.map((q, i) => (q ? `#${i}<-(${q[0].toFixed(2)},${q[1].toFixed(2)}) of the curve starting ${q[2]?.map(v => v.toFixed(1))}` : '')).filter(Boolean);
    if (who.length) console.log('     covering: ' + who.join('   '));
  }
  for (let i = 0; i < samples.length;) {
    if (isCovered[i]) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && !isCovered[j + 1]) j++;
    // one sample of overlap into the tarmac either side, so the pieces meet without a seam
    const i0 = Math.max(0, i - 2), j0 = Math.min(samples.length - 1, j + 2);
    const part = samples.slice(i0, j0 + 1);
    for (let k = i; k <= j; k++) {
      const kk = cKey(samples[k][0], samples[k][1]);
      if (!covered.has(kk)) covered.set(kk, []);
      covered.get(kk).push([samples[k][0], samples[k][1], first]);
    }
    i = j + 1;
    if (part.length < 2) continue;
    const simple = simplify(part, 0.12);
    // the lane's own width; at a road end it is the width of the lane it joins, exactly
    const h0 = (i0 === 0 && A ? A.pitch : src.pitch) / 2, h1 = (j0 === samples.length - 1 && B ? B.pitch : src.pitch) / 2;
    const ring = strip(simple, h0, h1);
    if (!ring) continue;
    features.push({ z: zHere === -1e9 ? 0 : zHere, f: { type: 'Feature', properties: src.props, geometry: { type: 'Polygon', coordinates: [toRing(ring)] } } });
    strips++;
    any = true;
  }
  if (!any) dropped++;
}
{
  angles.sort((x, y) => x - y);
  const q = p => angles[Math.floor(angles.length * p)]?.toFixed(2);
  log(`lane curve vs the road it starts on, angle: median ${q(0.5)}°, 90% under ${q(0.9)}°, 99% under ${q(0.99)}°, over 5°: ${(100 * angles.filter(a => a > 5).length / angles.length).toFixed(2)}% of ${angles.length}`);
}
log(`${strips} junction strips (${dropped} repeated lane paths dropped, ${attached} curves start or end on a road)`);

// --- everything that is not a road passes through, as before --------------------------------------
log('adding areas, prefab outlines, labels and icons');
const rest = [];
{
  const gj = read(LINES);
  for (const f of gj.features) {
    const p = f.properties ?? {};
    if (p.type === 'road' && f.geometry?.type === 'LineString') continue;
    rest.push(f);
  }
}
// lowest first, so a bridge is drawn over what it crosses
features.sort((a, b) => a.z - b.z);
const out = rest.concat(features.map(x => x.f));
{
  // one string for a whole world would be over half a gigabyte: write it in pieces
  const fd = fs.openSync(OUT, 'w');
  fs.writeSync(fd, '{"type":"FeatureCollection","features":[');
  const PIECE = 5000;
  for (let i = 0; i < out.length; i += PIECE) {
    const chunk = out.slice(i, i + PIECE).map(x => JSON.stringify(x)).join(',');
    fs.writeSync(fd, (i > 0 ? ',' : '') + chunk);
  }
  fs.writeSync(fd, ']}');
  fs.closeSync(fd);
}
log(`${out.length} features written (${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB)`);
console.log(`road surfaces: ${ribbons} roads, ${strips} junction strips, ${out.length} features`);
