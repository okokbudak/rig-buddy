// Turns the game's own junction geometry into tarmac, the way TruckSim GPS
// does it: every prefab (junction, roundabout, service entry) carries the lane
// curves the game drives through it, and drawing each of those as a strip of
// tarmac gives the junction its real shape - instead of guessing a patch over
// the road ends that happen to lie near each other.
//
// Lanes that run alongside each other collapse into one strip: at a junction
// what matters is the tarmac, not how many lanes are painted on it.
//
// usage: node prefab-surfaces.mjs <prefab-curves.geojson> <out.geojson> [--width <game metres>]
import fs from 'node:fs';

const args = process.argv.slice(2);
const widthAt = args.indexOf('--width');
const WIDTH_M = widthAt >= 0 ? Number(args.splice(widthAt, 2)[1]) : 9;
const [inFile, outFile] = args;

const M_PER_DEG = 111320;
const SCALE = 19.15;                     // map metres per game metre
const HALF = (WIDTH_M * SCALE) / 2 / M_PER_DEG;
const STEP_M = WIDTH_M * SCALE * 0.8;    // how far apart two lanes must be to both be drawn
const POINT_M = 40;                      // points closer together than this add nothing
const CAP_STEPS = 4;

const curves = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const taken = new Set();
const key = p => `${Math.round((p[0] * Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG) / STEP_M)},`
  + `${Math.round((p[1] * M_PER_DEG) / STEP_M)}`;
const out = [];
let parts = 0, kept = 0;

for (const f of curves.features) {
  const g = f.geometry;
  if (!g) continue;
  const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
  for (const line of lines) {
    parts++;
    if (line.length < 2) continue;
    // a lane whose whole length is already covered by tarmac adds nothing
    if (line.every(p => taken.has(key(p)))) continue;
    for (const p of line) taken.add(key(p));
    const ring = strip(line);
    if (!ring) continue;
    out.push({
      type: 'Feature',
      properties: { type: 'road', roadType: 'local', hidden: false, junction: true, width: WIDTH_M },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
    kept++;
  }
}

fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(`prefab surfaces: ${kept} strips of ${parts} lane curves, ${WIDTH_M} m wide`);

/** A lane curve as a strip of tarmac: one side, round the end, back, round the start. */
function strip(line) {
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
    ...cap(pts[pts.length - 1], normals[normals.length - 1]),
    ...right.reverse(),
    ...cap(pts[0], [-normals[0][0], -normals[0][1]]),
  ];
  ring.push(ring[0]);
  return ring.map(p => [p[0] / cos, p[1]]);
}

function cap(point, from) {
  const base = Math.atan2(from[1], from[0]);
  const pts = [];
  for (let i = 1; i < CAP_STEPS; i++) {
    const a = base - Math.PI * (i / CAP_STEPS);
    pts.push([point[0] + Math.cos(a) * HALF, point[1] + Math.sin(a) * HALF]);
  }
  return pts;
}
