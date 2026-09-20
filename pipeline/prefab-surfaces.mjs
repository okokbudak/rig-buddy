// Turns the game's own junction geometry into tarmac, the way TruckSim GPS
// does it: every prefab (junction, roundabout, service entry) carries the lane
// curves the game drives through it, and drawing each of those as a strip of
// tarmac gives the junction its real shape - instead of guessing a patch over
// the road ends that happen to lie near each other.
//
// Lanes that run alongside each other collapse into one strip: at a junction
// what matters is the tarmac, not how many lanes are painted on it.
//
// Each strip is as wide as the road it joins (--roads: the map's road lines, which
// carry their width), so a slip road's lane is not drawn on top of a single-lane
// road as a much wider strip. Lanes that run alongside each other still collapse
// into one strip of that width.
//
// usage: node prefab-surfaces.mjs <prefab-curves.geojson> <out.geojson> [--roads <roads.geojson>] [--width <default game metres>]
import fs from 'node:fs';

const args = process.argv.slice(2);
const widthAt = args.indexOf('--width');
const DEFAULT_M = widthAt >= 0 ? Number(args.splice(widthAt, 2)[1]) : 9;
const roadsAt = args.indexOf('--roads');
const roadsFile = roadsAt >= 0 ? args.splice(roadsAt, 2)[1] : null;
const [inFile, outFile] = args;
const MIN_M = 4.5, MAX_M = 9;            // one lane .. the two lanes of a carriageway

const M_PER_DEG = 111320;
const SCALE = 19.15;                     // map metres per game metre
const POINT_M = 40;                      // points closer together than this add nothing
const CAP_STEPS = 4;
const REACH_M = 300;                     // how far from a curve's end a road still counts as the one it joins

// the width of every road end, to give each strip the width of the road it joins
const ends = new Map();
const cellOf = (lon, lat) => `${Math.round((lon * Math.cos((lat * Math.PI) / 180) * M_PER_DEG) / REACH_M)},`
  + `${Math.round((lat * M_PER_DEG) / REACH_M)}`;
const metresApart = (a, b) =>
  Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * M_PER_DEG;
if (roadsFile) {
  const roads = JSON.parse(fs.readFileSync(roadsFile, 'utf8'));
  for (const f of roads.features) {
    if (f.properties?.type !== 'road' || f.geometry?.type !== 'LineString' || !f.properties.width) continue;
    const c = f.geometry.coordinates;
    for (const p of [c[0], c[c.length - 1]]) {
      const k = cellOf(p[0], p[1]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push([p, f.properties.width]);
    }
  }
  roads.features = null;
}
/** Width of the road that ends nearest to this point, or null when none is close. */
function widthNear(p) {
  const kx = Math.round((p[0] * Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG) / REACH_M);
  const ky = Math.round((p[1] * M_PER_DEG) / REACH_M);
  let best = REACH_M, width = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [q, w] of ends.get(`${kx + dx},${ky + dy}`) ?? []) {
        const d = metresApart(p, q);
        if (d < best) { best = d; width = w; }
      }
    }
  }
  return width;
}
/** A curve is as wide as the road at its narrower end: a slip road is one lane, even where it leaves a motorway. */
function widthOf(line) {
  const a = widthNear(line[0]), b = widthNear(line[line.length - 1]);
  const w = a !== null && b !== null ? Math.min(a, b) : (a ?? b ?? DEFAULT_M);
  return Math.max(MIN_M, Math.min(MAX_M, w));
}

const curves = JSON.parse(fs.readFileSync(inFile, 'utf8'));
// lanes running alongside each other collapse into one strip, per width class
const takenByWidth = new Map();
const out = [];
let parts = 0, kept = 0;
const widths = {};

for (const f of curves.features) {
  const g = f.geometry;
  if (!g) continue;
  const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
  for (const line of lines) {
    parts++;
    if (line.length < 2) continue;
    const width = Math.round(widthOf(line) * 2) / 2;
    const step = width * SCALE * 0.8;      // how far apart two lanes must be to both be drawn
    const taken = takenByWidth.get(width) ?? takenByWidth.set(width, new Set()).get(width);
    const key = p => `${Math.round((p[0] * Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG) / step)},`
      + `${Math.round((p[1] * M_PER_DEG) / step)}`;
    // a lane whose whole length is already covered by tarmac adds nothing
    if (line.every(p => taken.has(key(p)))) continue;
    for (const p of line) taken.add(key(p));
    const ring = strip(line, (width * SCALE) / 2 / M_PER_DEG);
    if (!ring) continue;
    widths[width] = (widths[width] ?? 0) + 1;
    out.push({
      type: 'Feature',
      properties: { type: 'road', roadType: 'local', hidden: false, junction: true, width },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
    kept++;
  }
}

fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(`prefab surfaces: ${kept} strips of ${parts} lane curves; widths ${JSON.stringify(widths)}`);

/** A lane curve as a strip of tarmac: one side, round the end, back, round the start. */
function strip(line, HALF) {
  const cos = Math.max(0.05, Math.cos((line[0][1] * Math.PI) / 180));
  const pts = [];
  for (const c of line) {
    const p = [c[0] * cos, c[1]];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) * M_PER_DEG > POINT_M) pts.push(p);
  }
  if (pts.length < 2) return null;
  const normals = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    normals.push([-dy / len, dx / len]);
  }
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    const mx = a[0] + b[0], my = a[1] + b[1];
    const len = Math.hypot(mx, my);
    if (len > 1.2) {
      const s = (2 / len) * HALF;
      left.push([pts[i][0] + (mx / 2) * s, pts[i][1] + (my / 2) * s]);
      right.push([pts[i][0] - (mx / 2) * s, pts[i][1] - (my / 2) * s]);
    } else {
      left.push([pts[i][0] + a[0] * HALF, pts[i][1] + a[1] * HALF],
        [pts[i][0] + b[0] * HALF, pts[i][1] + b[1] * HALF]);
      right.push([pts[i][0] - a[0] * HALF, pts[i][1] - a[1] * HALF],
        [pts[i][0] - b[0] * HALF, pts[i][1] - b[1] * HALF]);
    }
  }
  const ring = [
    ...left,
    ...cap(pts[pts.length - 1], normals[normals.length - 1], HALF),
    ...right.reverse(),
    ...cap(pts[0], [-normals[0][0], -normals[0][1]], HALF),
  ];
  ring.push(ring[0]);
  return ring.map(p => [p[0] / cos, p[1]]);
}

function cap(point, from, HALF) {
  const base = Math.atan2(from[1], from[0]);
  const pts = [];
  for (let i = 1; i < CAP_STEPS; i++) {
    const a = base - Math.PI * (i / CAP_STEPS);
    pts.push([point[0] + Math.cos(a) * HALF, point[1] + Math.sin(a) * HALF]);
  }
  return pts;
}
