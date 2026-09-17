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
const CAP_STEPS = 5;          // points in the half circle at each end

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

const roadEnds = []; // every road end, for the junction pads below
for (const f of input) {
  const p = f.properties ?? {};
  if (p.type !== 'road' || f.geometry?.type !== 'LineString') {
    out.push(f); // prefab surfaces, areas, labels and POIs pass through
    continue;
  }
  const line = dedupe(f.geometry.coordinates);
  if (line.length < 2) { skipped++; continue; }
  for (const [a, b] of [[line[0], line[1]], [line[line.length - 1], line[line.length - 2]]]) {
    const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    roadEnds.push({ point: a, dir: [dx / len, dy / len], width: widthOf(p), properties: p, height: heightOf(p) });
  }
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

// Where roads meet, their round ends still leave a wedge between the outer
// edges - the dark nick in the fork of a slip road - and the ends are often not
// even at the same point: at a junction the game leaves a gap of a few metres
// between them, with its own geometry (a prefab) that the map does not always
// carry. A patch of tarmac over each group of ends that lie close together
// covers both, which is what a junction looks like anyway. Ends that simply
// continue the same road, straight and equally wide, get nothing.
const CLUSTER_M = 260;        // map metres, i.e. ~14 game metres
const PAD_MAX_M = 260;
let pads = 0;
const grid = new Map();
const cell = p => `${Math.round((p[0] * Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG) / CLUSTER_M)},`
  + `${Math.round((p[1] * M_PER_DEG) / CLUSTER_M)}`;
roadEnds.forEach((e, i) => {
  const k = cell(e.point);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});
const metresApart = (a, b) =>
  Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * M_PER_DEG;
const taken = new Uint8Array(roadEnds.length);
for (let i = 0; i < roadEnds.length; i++) {
  if (taken[i]) continue;
  const group = [i];
  taken[i] = 1;
  const kx = Math.round((roadEnds[i].point[0] * Math.cos((roadEnds[i].point[1] * Math.PI) / 180) * M_PER_DEG) / CLUSTER_M);
  const ky = Math.round((roadEnds[i].point[1] * M_PER_DEG) / CLUSTER_M);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${kx + dx},${ky + dy}`) ?? []) {
        if (taken[j] || metresApart(roadEnds[i].point, roadEnds[j].point) > CLUSTER_M) continue;
        group.push(j);
        taken[j] = 1;
      }
    }
  }
  if (group.length < 2) continue;
  let minW = Infinity, maxW = 0, widest = roadEnds[group[0]], straight = true;
  let lon = 0, lat = 0;
  for (const j of group) {
    const e = roadEnds[j];
    minW = Math.min(minW, e.width);
    if (e.width > maxW) { maxW = e.width; widest = e; }
    lon += e.point[0];
    lat += e.point[1];
  }
  lon /= group.length;
  lat /= group.length;
  if (group.length === 2) {
    const dot = roadEnds[group[0]].dir[0] * roadEnds[group[1]].dir[0]
      + roadEnds[group[0]].dir[1] * roadEnds[group[1]].dir[1];
    straight = Math.abs(dot) > 0.95 && maxW - minW < 2;
  } else {
    straight = false;
  }
  if (straight) continue;
  let spread = 0;
  for (const j of group) spread = Math.max(spread, metresApart([lon, lat], roadEnds[j].point));
  const radius = Math.min(PAD_MAX_M, Math.max((maxW * SCALE) / 2, spread));
  out.push({
    type: 'Feature',
    properties: widest.properties,
    geometry: { type: 'Polygon', coordinates: [disc([lon, lat], radius / M_PER_DEG)] },
    height: widest.height,
  });
  pads++;
}
console.log(`junction pads: ${pads} for ${roadEnds.length} road ends`);

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
 * (in degrees of latitude): up one side, round the end, back down the other,
 * round the start. The round ends matter - two roads that meet share a node, so
 * the half disc of radius half-width around it covers the wedge between them
 * however sharply they turn, where a squared-off end leaves either a notch or a
 * rectangular flap sticking out of the junction.
 *
 * Corners take the average of the two segment normals (a mitre); a corner too
 * sharp for that is bevelled with both normals, because a long mitre spike
 * crosses the other side of the road and the polygon turns into a bowtie.
 */
function surface(line, halfStart, halfEnd = halfStart) {
  const cos = Math.max(0.05, Math.cos((line[0][1] * Math.PI) / 180));
  // work in metre-like units so the two axes are comparable
  const pts = line.map(c => [c[0] * cos, c[1]]);
  const dirs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    dirs.push([dx / len, dy / len]);
  }
  const n = pts.length;
  const normals = dirs.map(d => [-d[1], d[0]]);
  const halfAtPoint = i => halfStart + ((halfEnd - halfStart) * i) / (n - 1);
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    const half = halfAtPoint(i);
    const mx = a[0] + b[0], my = a[1] + b[1];
    const len = Math.hypot(mx, my);
    if (len > 1.2) { // gentle corner: one mitred point per side
      const scale = (2 / len) * half;
      left.push([pts[i][0] + (mx / 2) * scale, pts[i][1] + (my / 2) * scale]);
      right.push([pts[i][0] - (mx / 2) * scale, pts[i][1] - (my / 2) * scale]);
    } else { // sharp corner: bevel, so nothing crosses the road
      left.push([pts[i][0] + a[0] * half, pts[i][1] + a[1] * half],
        [pts[i][0] + b[0] * half, pts[i][1] + b[1] * half]);
      right.push([pts[i][0] - a[0] * half, pts[i][1] - a[1] * half],
        [pts[i][0] - b[0] * half, pts[i][1] - b[1] * half]);
    }
  }
  const ring = [
    ...left,
    ...cap(pts[n - 1], normals[normals.length - 1], halfEnd),
    ...right.reverse(),
    ...cap(pts[0], [-normals[0][0], -normals[0][1]], halfStart),
  ];
  ring.push(ring[0]);
  return ring.map(p => [p[0] / cos, p[1]]);
}

/** A circle of `half` degrees of latitude around a point, for a junction pad. */
function disc(point, half) {
  const cos = Math.max(0.05, Math.cos((point[1] * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    ring.push([point[0] + (Math.cos(a) * half) / cos, point[1] + Math.sin(a) * half]);
  }
  return ring;
}

/**
 * The half circle from `from` round to the opposite side, going the way that
 * bulges past the end of the road (the points in between; the sides of the road
 * already carry the two ends).
 */
function cap(point, from, half) {
  const base = Math.atan2(from[1], from[0]);
  const pts = [];
  for (let i = 1; i < CAP_STEPS; i++) {
    const a = base - Math.PI * (i / CAP_STEPS);
    pts.push([point[0] + Math.cos(a) * half, point[1] + Math.sin(a) * half]);
  }
  return pts;
}
