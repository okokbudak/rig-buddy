// Post-processes truckermudgeon's `generator map -t geojson` output for the
// head-unit style, before tippecanoe:
//  - fixes road classes: short local/divided/unknown pieces whose both ends
//    touch freeways (bridges, look changes, ramps inside interchanges) become
//    freeway, and unknown roads inherit their neighbours' class;
//  - drops hidden roads/prefabs (never shown);
//  - assigns per-feature tippecanoe minzooms so low-zoom tiles stay small
//    (upstream keeps every point from z4, giving 100-400 KB tiles).
//
// usage: node postprocess-geojson.js in.geojson out.geojson
const fs = require('fs');

const [inFile, outFile] = process.argv.slice(2);
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
// Two outputs: <out>-low.geojson for z4-z8 (major roads + labels only) and
// <out>-high.geojson for z9-z13 (everything visible). tippecanoe's per-feature
// `tippecanoe.minzoom` loses features with this tippecanoe version, so the
// zoom split is done with two passes + tile-join instead.
const all = [], low = [];
for (const f of feats) {
  const p = f.properties;
  if (p.hidden === true && (p.type === 'road' || p.type === 'prefab')) continue;
  delete f.tippecanoe;
  all.push(f);
  const major = p.type === 'road' && (p.roadType === 'freeway' || p.roadType === 'divided');
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
