// Post-processes truckermudgeon's `generator map -t geojson` output for the
// head-unit style, before tippecanoe:
//  - fixes road classes: short local/divided/unknown pieces whose both ends
//    touch freeways (bridges, look changes, ramps inside interchanges) become
//    freeway, and unknown roads inherit their neighbours' class;
//  - drops hidden prefabs, and keeps hidden roads (the app draws them thin);
//  - assigns per-feature tippecanoe minzooms so low-zoom tiles stay small
//    (upstream keeps every point from z4, giving 100-400 KB tiles).
//
// usage: node postprocess-geojson.js in.geojson out.geojson [--looks <roadLooks.json>]
const fs = require('fs');

const argv = process.argv.slice(2);
const looksAt = argv.indexOf('--looks');
const looksFile = looksAt >= 0 ? argv.splice(looksAt, 2)[1] : null;
const [inFile, outFile] = argv;

// How wide a road is, in game metres. A road item often says its lane counts
// are -1, meaning "as the road look says", so the looks are the real source:
// lanes each way, the shoulders, and the gap between the carriageways of a
// divided road, which the map draws as one ribbon.
const LANE_M = 4.5;
const lookWidth = new Map();
if (looksFile) {
  const looks = JSON.parse(fs.readFileSync(looksFile, 'utf8'));
  const list = Array.isArray(looks) ? looks : Object.entries(looks).map(([token, v]) => ({ token, ...v }));
  for (const l of list) {
    const lanes = (l.lanesLeft?.length ?? 0) + (l.lanesRight?.length ?? 0);
    if (!lanes) continue;
    lookWidth.set(l.token, lanes * LANE_M + (l.shoulderSpaceLeft ?? 0) + (l.shoulderSpaceRight ?? 0)
      + Math.abs(l.offset ?? 0));
  }
  console.log('road looks:', lookWidth.size);
}
function widthOf(p) {
  // The road's own lane counts first: a divided road is two carriageways with
  // their own geometry, and its look describes both together - using that for
  // each of them would draw one over the other.
  const lanes = Math.max(0, p.leftLanes ?? 0) + Math.max(0, p.rightLanes ?? 0);
  if (lanes) return Math.round(lanes * LANE_M + (p.shoulderSpaceLeft ?? 0) + (p.shoulderSpaceRight ?? 0));
  return Math.round(lookWidth.get(p.lookToken) ?? 2 * LANE_M + 2.5);
}

const gj = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const feats = gj.features;
console.log('features in:', feats.length);

// --- road class fixing -------------------------------------------------------
const roads = feats.filter(f => f.properties.type === 'road' && f.geometry.type === 'LineString');
const touching = new Map(); // nodeUid -> Set<road index>
roads.forEach((f, i) => {
  for (const k of ['startNodeUid', 'endNodeUid']) {
    const n = f.properties[k];
    if (!n) continue;
    if (!touching.has(n)) touching.set(n, []);
    touching.get(n).push(i);
  }
});
const endTypes = (i, which) => {
  const n = roads[i].properties[which];
  return n ? (touching.get(n) || []).filter(j => j !== i).map(j => roads[j].properties.roadType) : [];
};
// "major" = freeway or divided: both are drawn in the highway color, since DLC
// motorways (e.g. Road to the Black Sea) are often classified as divided.
const isMajor = t => t === 'freeway' || t === 'divided';
let changed = { toMajor: 0, unknownResolved: 0 };
for (let pass = 0; pass < 3; pass++) {
  roads.forEach((f, i) => {
    const p = f.properties;
    if (isMajor(p.roadType) || p.roadType === 'train' || p.roadType === 'tram') return;
    const a = endTypes(i, 'startNodeUid'), b = endTypes(i, 'endNodeUid');
    const majorA = a.filter(isMajor), majorB = b.filter(isMajor);
    // short pieces sandwiched between highway pieces (bridges, look changes)
    if (majorA.length && majorB.length && lengthDeg(f) < 0.05) {
      p.roadType = majorA.includes('freeway') || majorB.includes('freeway') ? 'freeway' : 'divided';
      changed.toMajor++;
    } else if (p.roadType === 'unknown') {
      const all = a.concat(b).filter(t => t !== 'unknown');
      if (all.length) {
        p.roadType = mostCommon(all);
        changed.unknownResolved++;
      }
    }
  });
}
for (const f of roads) if (f.properties.roadType === 'unknown') f.properties.roadType = 'local';
console.log('road classes fixed:', JSON.stringify(changed));

// --- filtering -----------------------------------------------------------------
// Two outputs: <out>-low.geojson for the country overview (major roads and
// labels only) and <out>-high.geojson for everything visible, from the
// regional view down. build-map-data.mjs tiles them into one map.
const all = [], low = [];
for (const f of feats) {
  const p = f.properties;
  // Hidden roads (a third of the network: city streets, depot and service
  // approaches the game's own map leaves out) are kept - the app draws them as
  // thin lines, like truckermudgeon's own map does. Without them the network
  // falls apart into pieces wherever a road leaves the trunk route.
  if (p.hidden === true && p.type === 'prefab') continue;
  delete f.tippecanoe;
  // How wide the road really is, in game metres. The map is about 19x game
  // scale, so a road drawn thinner than it is leaves the truck - which drives
  // in a lane, not on the centre line - beside it instead of on it.
  if (p.type === 'road') p.width = widthOf(p);
  all.push(f);
  const major = p.type === 'road' && p.hidden !== true && (p.roadType === 'freeway' || p.roadType === 'divided');
  if (major || p.type === 'city' || p.type === 'country' || p.type === 'ferry') low.push(f);
}
const base = outFile.replace(/\.geojson$/, '');
fs.writeFileSync(`${base}-high.geojson`, JSON.stringify({ type: 'FeatureCollection', features: all }));
fs.writeFileSync(`${base}-low.geojson`, JSON.stringify({ type: 'FeatureCollection', features: low }));
console.log('features out: high', all.length, 'low', low.length);

function lengthDeg(f) {
  const c = f.geometry.coordinates;
  let l = 0;
  for (let i = 1; i < c.length; i++) l += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  return l;
}
function mostCommon(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
}
