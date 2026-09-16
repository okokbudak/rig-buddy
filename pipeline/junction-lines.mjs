// Turns the generator's prefab lane curves into map lines, so junctions are
// drawn as roads instead of being a gap: `generator map` emits only a surface
// (often nothing at all) where a junction is, which is why roads looked cut
// off and the truck seemed to drive beside them.
//
// Each curve inherits the class of the road it continues (motorway junctions
// stay motorway-coloured), and lanes that run on top of each other are kept
// once.
//
// usage: node junction-lines.mjs <map.geojson> <prefab-curves.geojson> <out.geojson>
import fs from 'node:fs';

const [mapFile, curveFile, outFile] = process.argv.slice(2);
const M_PER_DEG = 111320;
const CELL = 0.0015;                 // ~110 m index cells
const INHERIT_M = 60;                // how far a curve looks for the road it continues
const SAME_SPOT_M = 20;              // roads ending this close to each other meet at one point
const DEDUPE_M = Number(process.env.RIGBUDDY_JUNCTION_DEDUPE ?? 3); // lanes closer than this count as one line

const cellKey = (lon, lat) => `${Math.round(lon / CELL)},${Math.round(lat / CELL)}`;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * M_PER_DEG;

// --- road ends, with their class ------------------------------------------------------
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const ends = new Map();
for (const f of map.features) {
  if (f.properties?.type !== 'road' || f.geometry.type !== 'LineString') continue;
  const c = f.geometry.coordinates;
  for (const p of [c[0], c[c.length - 1]]) {
    const k = cellKey(p[0], p[1]);
    (ends.get(k) ?? ends.set(k, []).get(k)).push([p, f.properties.roadType ?? 'local']);
  }
}
map.features = null;

// how a road class weighs against another: a lane is only as big as the
// smaller of the two roads it joins, so a slip road off a motorway stays local
const RANK = { local: 0, no_vehicles: 0, tram: 1, train: 1, divided: 2, freeway: 3 };
const rank = t => RANK[t] ?? 0;

/** The class of the road that ends at `point`: where several do (a motorway and
 *  its slip road end at the same spot), the biggest of them. */
const classOf = point => {
  let near = null, nearD = INHERIT_M, best = null;
  const kx = Math.round(point[0] / CELL), ky = Math.round(point[1] / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [p, type] of ends.get(`${kx + dx},${ky + dy}`) ?? []) {
        const d = metres(point, p);
        if (d < nearD) { nearD = d; near = type; }
        if (d <= SAME_SPOT_M && (best === null || rank(type) > rank(best))) best = type;
      }
    }
  }
  return best ?? near;
};

// --- curves -> lines ------------------------------------------------------------------
const curves = JSON.parse(fs.readFileSync(curveFile, 'utf8'));
const taken = new Map(); // dedupe grid: rounded point -> true
const takenKey = p => `${Math.round((p[0] * M_PER_DEG * Math.cos((p[1] * Math.PI) / 180)) / DEDUPE_M)},${Math.round((p[1] * M_PER_DEG) / DEDUPE_M)}`;
const out = [];
let parts = 0, kept = 0, points = 0;

for (const f of curves.features) {
  const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const line of lines) {
    parts++;
    if (line.length < 2) continue;
    // a lane that another kept lane already covers end to end adds nothing
    if (line.every(p => taken.has(takenKey(p)))) continue;
    for (const p of line) taken.set(takenKey(p), true);
    // both ends: a lane that carries a motorway through its interchange is a
    // motorway, a lane that leaves it for a village road is not
    const a = classOf(line[0]), b = classOf(line[line.length - 1]);
    const roadType = (a && b) ? (rank(a) <= rank(b) ? a : b) : (a ?? b ?? 'local');
    out.push({
      type: 'Feature',
      // one lane wide, in game metres (see postprocess-geojson.js)
      properties: { type: 'road', roadType, hidden: false, junction: true, width: 6 },
      geometry: { type: 'LineString', coordinates: line },
    });
    kept++;
    points += line.length;
  }
}

// Tiles keep this order and the app draws in it, so the bigger roads' lanes go
// last: a slip road must not paint its grey over the motorway it leaves.
out.sort((a, b) => rank(a.properties.roadType) - rank(b.properties.roadType));
fs.writeFileSync(outFile, JSON.stringify({ type: 'FeatureCollection', features: out }));
const byType = {};
for (const f of out) byType[f.properties.roadType] = (byType[f.properties.roadType] ?? 0) + 1;
console.log(`junction lines: kept ${kept} of ${parts} lane curves, ${points} points`);
console.log(`  classes: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);
