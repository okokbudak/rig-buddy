// Turns road lines into road surfaces, the way the game's own map (and
// TruckSim GPS) draws them: every road becomes a polygon as wide as the road
// really is, so a motorway is a ribbon with edges instead of a fat line, lanes
// through junctions sit inside the surface, and a bridge can be drawn over what
// runs beneath it (features carry the elevation they were built at).
//
// The map is about 19x game scale, so a width in game metres becomes
// width * SCALE metres on the map.
//
// usage: node road-polygons.mjs <roads.geojson> <out.geojson> [--nodes <parser nodes.json>]
import fs from 'node:fs';

const args = process.argv.slice(2);
const nodesAt = args.indexOf('--nodes');
const nodesFile = nodesAt >= 0 ? args.splice(nodesAt, 2)[1] : null;
const [inFile, outFile, ...extra] = args;

// Elevation, to stack a bridge over what runs beneath it: the tiles keep the
// order the features are written in, and the app draws them in that order.
const elevation = new Map();
if (nodesFile) {
  const nodes = JSON.parse(fs.readFileSync(nodesFile, 'utf8'));
  for (const n of Array.isArray(nodes) ? nodes : Object.values(nodes)) elevation.set(n.uid, n.z ?? 0);
  console.log(`elevations: ${elevation.size} nodes`);
}
const heightOf = p => Math.max(elevation.get(p.startNodeUid) ?? 0, elevation.get(p.endNodeUid) ?? 0);
const M_PER_DEG = 111320;
const SCALE = 19.15;          // map metres per game metre (ETS2/ATS map factor)
const MIN_WIDTH_M = 4;        // a road is never drawn thinner than this, in game metres
const CAP_STEPS = 4;          // points per rounded end

const files = [inFile, ...extra];
const out = [];
let roads = 0, skipped = 0;

const input = [];
for (const file of files) {
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const f of gj.features) input.push(f);
  gj.features = null;
}

// What meets at each node, so a road can be drawn as wide as its neighbour
// where they join: where a lane is gained or lost the width then slides from
// one to the other instead of stepping, the way TruckSim GPS's own surfaces do
// (StartHalfWidth / EndHalfWidth per road).
const atNode = new Map();
const widthOf = p => Math.max(MIN_WIDTH_M, p.width ?? 12);
for (const f of input) {
  const p = f.properties ?? {};
  if (p.type !== 'road' || f.geometry?.type !== 'LineString') continue;
  for (const uid of [p.startNodeUid, p.endNodeUid]) {
    if (!uid) continue;
    const w = widthOf(p);
    atNode.set(uid, Math.max(atNode.get(uid) ?? 0, w));
  }
}
/** Half the width to use at one end: half way to the widest road that joins there. */
const halfAt = (p, uid) => {
  const own = widthOf(p);
  const neighbour = atNode.get(uid) ?? own;
  return ((own + Math.min(neighbour, own * 2)) / 2) * SCALE / 2 / M_PER_DEG;
};

for (const f of input) {
  const p = f.properties ?? {};
  if (p.type !== 'road' || f.geometry?.type !== 'LineString') {
    out.push(f); // prefab surfaces, areas, labels and POIs pass through
    continue;
  }
  const line = dedupe(f.geometry.coordinates);
  if (line.length < 2) { skipped++; continue; }
  const ring = surface(line, halfAt(p, p.startNodeUid), halfAt(p, p.endNodeUid));
  if (!ring) { skipped++; continue; }
  out.push({
    type: 'Feature',
    properties: p,
    geometry: { type: 'Polygon', coordinates: [ring] },
    height: heightOf(p),
  });
  roads++;
}

// lowest first, so a bridge is drawn over the road it crosses; everything that
// is not a road (areas, junction surfaces, labels) keeps its place underneath
out.sort((a, b) => (a.height ?? -1e9) - (b.height ?? -1e9));
for (const f of out) delete f.height;
fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(`road surfaces: ${roads} roads (${skipped} too short), ${out.length} features out`);

/** Drops repeated points, which would leave a zero-length segment with no direction. */
function dedupe(coords) {
  const out = [coords[0]];
  for (const c of coords.slice(1)) {
    const last = out[out.length - 1];
    if (Math.abs(c[0] - last[0]) > 1e-9 || Math.abs(c[1] - last[1]) > 1e-9) out.push(c);
  }
  return out;
}

/**
 * The outline of a road along `line`, from half-width `halfStart` to `halfEnd`
 * (in degrees of latitude): up one side, round the end, back down the other.
 * Corners use the average of the two segment normals (a mitre), limited so a
 * hairpin can't throw a spike across the map.
 */
function surface(line, halfStart, halfEnd = halfStart) {
  const cos = Math.max(0.05, Math.cos((line[0][1] * Math.PI) / 180));
  // work in metre-like units so the two axes are comparable
  const pts = line.map(c => [c[0] * cos, c[1]]);
  const n = pts.length;
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    normals.push([-dy / len, dx / len]);
  }
  const at = i => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    const mx = a[0] + b[0], my = a[1] + b[1];
    const len = Math.hypot(mx, my);
    if (len < 1e-6) return a; // a full turn-back: keep the incoming side
    const scale = Math.min(4, 1 / Math.max(0.25, len / 2)); // mitre limit
    return [(mx / len) * scale, (my / len) * scale];
  };
  // the width slides along the road, so a lane gained at the far end widens it
  // gradually instead of in one step
  const halfAtPoint = i => halfStart + ((halfEnd - halfStart) * i) / (n - 1);
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const m = at(i), half = halfAtPoint(i);
    left.push([pts[i][0] + m[0] * half, pts[i][1] + m[1] * half]);
    right.push([pts[i][0] - m[0] * half, pts[i][1] - m[1] * half]);
  }
  const ring = [
    ...left,
    ...cap(pts[n - 1], normals[normals.length - 1], halfEnd, false),
    ...right.reverse(),
    ...cap(pts[0], normals[0], halfStart, true),
  ];
  ring.push(ring[0]);
  return ring.map(p => [p[0] / cos, p[1]]);
}

/** Half circle around an end point, so roads meet without a notch. */
function cap(point, normal, half, start) {
  const dir = start ? -1 : 1;
  const base = Math.atan2(normal[1], normal[0]);
  const pts = [];
  for (let i = 1; i < CAP_STEPS; i++) {
    const a = base - dir * Math.PI * (i / CAP_STEPS);
    pts.push([point[0] + Math.cos(a) * half, point[1] + Math.sin(a) * half]);
  }
  return pts;
}
