// The places bus lines stop at, for the app's bus jobs: data/game/<map>-busStations.json.
//
// The game marks every bus stop with a cutscene item tagged "bus_stop" (the passengers getting on and off):
//   - "bus_c_*" ones are the city stops - a bus station or just a stop at the roadside - each belonging to the
//     nearest city;
//   - "bus_t_*" ones stand next to the viewpoints tourist lines visit; a save names those viewpoints by their photo
//     album token ("viewpoints.blkwtirana"), which the parser puts on the viewpoint's own cutscene item (album).
// The navigation server routes between road graph nodes only, so every stop gets the graph node nearest to it.
//
// Cities without a stop cutscene get their bus station / roadside bus bay prefabs instead (kind 'station').
//
// Output: [{ city, kind, nodeUid, x, y, fromCentre, snap }] (a city's stops, the one nearest its centre first) and
// [{ viewpoint, name, nodeUid, x, y, snap }]; snap is how far (m) the node is from the stop. Empty without the bus DLC.
//
// usage: node bus-stops.mjs --map europe --parser <parser dir> --graph <map-graph.json> --out <file>
import fs from 'node:fs';

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const map = arg('--map'), parser = arg('--parser'), graphFile = arg('--graph'), out = arg('--out');
if (!map || !parser || !graphFile || !out) {
  console.error('usage: bus-stops.mjs --map europe --parser <dir> --graph <file> --out <file>');
  process.exit(2);
}
const read = n => JSON.parse(fs.readFileSync(`${parser}/${map}-${n}.json`, 'utf8'));

const cutscenes = read('cutscenes');
const busStops = cutscenes.filter(c => (c.tags ?? []).includes('bus_stop') && c.x != null);
const action = c => String(c.actionStringParams?.[1] ?? '');
const cityStops = busStops.filter(c => action(c).startsWith('bus_c'));
const tourStops = busStops.filter(c => action(c).startsWith('bus_t'));
const viewpoints = cutscenes.filter(c => c.album && c.x != null);

const stops = [];
if (busStops.length) {
  const cities = read('cities');
  const nearestCity = (x, y) => {
    let best = null, bestD = Infinity;
    for (const c of cities) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return [best, bestD];
  };
  for (const s of cityStops) {
    const [city, d] = nearestCity(s.x, s.y);
    if (city) stops.push({ city: city.token, kind: 'stop', x: s.x, y: s.y, fromCentre: Math.round(d) });
  }
  // About half of the cities lines run to have no stop cutscene: there the bus stops at the city's bus station or
  // roadside bus bay (the bus prefabs; not the road templates for forks)
  const withStop = new Set(stops.map(s => s.city));
  const busPrefabs = new Set(read('prefabDescriptions')
    .filter(d => /\/bus_station\/|_bus[_.]/.test(d.path ?? '') && !/fork_temp|_tmpl\./.test(d.path ?? ''))
    .map(d => d.token));
  for (const p of read('prefabs')) {
    if (!busPrefabs.has(p.token) || p.x == null) continue;
    const [city, d] = nearestCity(p.x, p.y);
    if (city && !withStop.has(city.token)) {
      stops.push({ city: city.token, kind: 'station', x: p.x, y: p.y, fromCentre: Math.round(d), own: (p.nodeUids ?? []).map(String) });
    }
  }
  // a viewpoint's name: the viewpoint POI at the same place
  const names = new Map(read('pois').filter(p => p.type === 'viewpoint').map(p => [`${p.x},${p.y}`, p.label]));
  for (const v of viewpoints) {
    // where the tourist bus stops: the bus_t stop next to the viewpoint (a few metres), else the viewpoint itself
    let best = null, bestD = 300;
    for (const s of tourStops) {
      const d = Math.hypot(s.x - v.x, s.y - v.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    const at = best ?? v;
    stops.push({ viewpoint: v.album, name: names.get(`${v.x},${v.y}`) ?? '', x: at.x, y: at.y });
  }

  // the road graph's nodes and where they are; a grid of 1 km cells for the nearest-node search
  const graphText = fs.readFileSync(graphFile, 'utf8');
  const inGraph = new Set();
  for (const m of graphText.matchAll(/\[\s*"([0-9a-f]+)"\s*,\s*\{/g)) inGraph.add(m[1]);
  const CELL = 1000;
  const grid = new Map();
  const where = new Map(); // graph node -> [x, y]
  const nodesText = fs.readFileSync(`${parser}/${map}-nodes.json`, 'utf8');
  for (const m of nodesText.matchAll(/"uid"\s*:\s*"([0-9a-f]+)"\s*,\s*"x"\s*:\s*([-0-9.e+]+)\s*,\s*"y"\s*:\s*([-0-9.e+]+)/g)) {
    if (!inGraph.has(m[1])) continue;
    const x = Number(m[2]), y = Number(m[3]);
    where.set(m[1], [x, y]);
    const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    let cell = grid.get(key);
    if (!cell) grid.set(key, (cell = []));
    cell.push([m[1], x, y]);
  }
  const nearestNode = (x, y) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= 5 && (best == null || bestD > (r - 1) * CELL); r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue; // the ring only
          for (const [uid, nx, ny] of grid.get(`${i},${j}`) ?? []) {
            const d = Math.hypot(nx - x, ny - y);
            if (d < bestD) { bestD = d; best = uid; }
          }
        }
      }
    }
    return [best, bestD];
  };
  for (const s of stops) {
    // a station prefab's own road ends, when the graph has them: the road that really leads into it
    let [uid, d] = [null, Infinity];
    for (const n of s.own ?? []) {
      const hex = BigInt(n.startsWith('0x') ? n : `0x${n}`).toString(16);
      const at = where.get(hex);
      if (!at) continue;
      const dn = Math.hypot(at[0] - s.x, at[1] - s.y);
      if (dn < d) [uid, d] = [hex, dn];
    }
    if (uid == null) [uid, d] = nearestNode(s.x, s.y);
    delete s.own;
    s.nodeUid = uid;
    s.snap = Math.round(d);
  }
}

const usable = stops.filter(s => s.nodeUid != null);
usable.sort((a, b) => (a.city ?? '~').localeCompare(b.city ?? '~') || (a.fromCentre ?? 0) - (b.fromCentre ?? 0)
  || (a.viewpoint ?? '').localeCompare(b.viewpoint ?? ''));
fs.writeFileSync(out, JSON.stringify(usable));
const city = usable.filter(s => s.city);
const far = usable.filter(s => s.snap > 150).length;
console.log(`bus stops: ${city.length} in ${new Set(city.map(s => s.city)).size} cities, ${usable.length - city.length} viewpoints`
  + `${far ? `, ${far} more than 150 m from a road node` : ''}`);
