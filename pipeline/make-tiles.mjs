// Builds the app's MBTiles (gzipped Mapbox Vector Tiles) from GeoJSON, in
// plain Node: replaces tippecanoe so the map can be built on Windows without
// WSL. Each input covers a zoom range and is tiled without dropping features
// (postprocess-geojson.js already split the map into low / high zoom sets).
// Inputs whose zoom ranges overlap share the tiles they both cover.
//
// Memory: the map is never in memory as a whole (ETS2's road surfaces alone took
// over 7 GB that way). The inputs are read one feature at a time and spread over
// regions (the tiles of zoom REGION_Z, or of the input's first zoom when that is
// lower) in temporary files next to the output; then each region is tiled on its
// own. A feature near a region's edge goes into every region its tile buffer
// reaches, so the tiles come out as if the whole map had been tiled at once.
//
// usage: node make-tiles.mjs --layer ets2 --out ets2.mbtiles low.geojson:4:8 high.geojson:9:13
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

// the properties the app's map style reads (tippecanoe -y ...)
const ATTRS = ['type', 'roadType', 'color', 'hidden', 'width', 'poiType', 'sprite', 'scaleRank', 'capital', 'name', 'uid'];
const EXTENT = 4096;
const BUFFER = 160; // tippecanoe -b 10 (screen pixels of a 256 px tile) in tile units
// How hard lines are simplified before they go into a tile. geojson-vt's
// default (3) drops a fifth of the roads at low zoom, which tears the network
// apart; 0.5 keeps the detail tippecanoe used to give (~5% larger tiles).
// RIGBUDDY_TILE_TOLERANCE is there to try other values.
const TOLERANCE = Number(process.env.RIGBUDDY_TILE_TOLERANCE ?? 0.5);
// Region size: a zoom-7 tile is ~300 km wide; the densest one (Benelux / western Germany with
// the junction lanes) stays far below a GB.
const REGION_Z = 7;

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  if (i < 0) throw new Error(`missing ${name}`);
  return args.splice(i, 2)[1];
};
const layer = opt('--layer');
const outFile = opt('--out');
const passes = args.map(a => {
  // from the right: Windows paths have a colon of their own (D:\...)
  const m = /^(.+):(\d+):(\d+)$/.exec(a);
  if (!m) throw new Error(`bad input "${a}", expected file.geojson:minzoom:maxzoom`);
  return { file: m[1], minZ: Number(m[2]), maxZ: Number(m[3]) };
});

const tmp = `${outFile}.part`;
fs.rmSync(tmp, { force: true });
const db = new DatabaseSync(tmp);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  CREATE TABLE metadata (name TEXT, value TEXT);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
`);
const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');

/**
 * Calls back with each feature of a GeoJSON FeatureCollection, never holding the
 * file as one string (V8 cannot make a string over ~512 MB, and the road surfaces
 * are bigger than that) nor all its features at once. Scans the bytes for the
 * "features" array and parses one feature at a time.
 */
function forEachFeature(file, callback) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(32 * 1024 * 1024);
  const KEY = '"features"';
  let phase = 0; // 0 looking for the key, 1 waiting for "[", 2 between features, 3 inside a feature, 4 done
  let head = '';
  let depth = 0, inStr = false, esc = false, start = 0;
  let pieces = [];
  try {
    for (let n; phase < 4 && (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      if (phase === 3) start = 0;
      for (let i = 0; i < n && phase < 4; i++) {
        const c = buf[i];
        if (phase === 0) {
          head = (head + String.fromCharCode(c)).slice(-KEY.length);
          if (head === KEY) phase = 1;
        } else if (phase === 1) {
          if (c === 91) phase = 2; // [
        } else if (phase === 2) {
          if (c === 123) { // {
            phase = 3;
            depth = 1;
            inStr = esc = false;
            start = i;
          } else if (c === 93) phase = 4; // ]
        } else if (inStr) {
          if (esc) esc = false;
          else if (c === 92) esc = true; // backslash
          else if (c === 34) inStr = false;
        } else if (c === 34) inStr = true;
        else if (c === 123) depth++;
        else if (c === 125 && --depth === 0) {
          pieces.push(Buffer.from(buf.subarray(start, i + 1)));
          callback(JSON.parse(Buffer.concat(pieces).toString('utf8')));
          pieces = [];
          phase = 2;
        }
      }
      if (phase === 3) pieces.push(Buffer.from(buf.subarray(start, n)));
    }
  } finally {
    fs.closeSync(fd);
  }
}

const fields = {};
let bounds = [180, 90, -180, -90];
const stats = {};
const started = Date.now();
const regionDir = `${outFile}.regions`;

// Inputs whose zoom ranges overlap make one group: their tiles are merged. Groups are tiled one after the other.
const groups = [];
for (const pass of [...passes].sort((a, b) => a.minZ - b.minZ)) {
  const last = groups.at(-1);
  if (last && pass.minZ <= Math.max(...last.map(p => p.maxZ))) last.push(pass);
  else groups.push([pass]);
}

db.exec('BEGIN');
for (const group of groups) {
  const top = Math.min(...group.map(p => p.minZ));
  const regionZ = Math.min(REGION_Z, top);
  const regions = new Set();
  // a clean folder per group: region files of an earlier group must not mix in
  fs.rmSync(regionDir, { recursive: true, force: true });
  fs.mkdirSync(regionDir);
  group.forEach((pass, i) => {
    pass.prefix = `${i}-`;
    const count = spread(pass, regionZ, regions);
    console.log(`${path.basename(pass.file)}: ${count} features, zoom ${pass.minZ}-${pass.maxZ}`);
  });
  const sorted = [...regions].map(r => r.split('_').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  console.log(`  tiling ${sorted.length} regions of zoom ${regionZ}`);
  for (const [x, y] of sorted) {
    // One index per input of the group, for this region only; walked together, then let go.
    for (const pass of group) pass.index = indexRegion(pass, x, y);
    walk(group, regionZ, x, y);
    for (const pass of group) pass.index = null;
  }
}
db.exec('COMMIT');
fs.rmSync(regionDir, { recursive: true, force: true });

/**
 * Reads one input and writes each feature (with only the properties the style reads) to the file of every region
 * its bounding box touches, tile buffer included. Returns the number of features.
 */
function spread(pass, regionZ, regions) {
  const n = 1 << regionZ;
  const margin = BUFFER / EXTENT; // the tile buffer, in tiles of regionZ (deeper tiles have a smaller one)
  const pending = new Map(); // region -> lines not yet written
  let count = 0;
  const flush = (region, lines) => fs.appendFileSync(path.join(regionDir, pass.prefix + region), lines.join('\n') + '\n');
  forEachFeature(pass.file, f => {
    count++;
    const p = {};
    for (const k of ATTRS) {
      const v = f.properties?.[k];
      if (v === undefined || v === null) continue;
      p[k] = v;
      fields[k] ??= typeof v === 'number' ? 'Number' : typeof v === 'boolean' ? 'Boolean' : 'String';
    }
    f.properties = p;
    if (!f.geometry) return; // geojson-vt skips it as well
    extendBounds(f.geometry);
    const box = [180, 90, -180, -90];
    boxOf(f.geometry, box);
    const [ax, ay] = tileFraction(box[0], box[3], n);
    const [bx, by] = tileFraction(box[2], box[1], n);
    const line = JSON.stringify(f);
    for (let x = Math.max(0, Math.floor(ax - margin)); x <= Math.min(n - 1, Math.floor(bx + margin)); x++) {
      for (let y = Math.max(0, Math.floor(ay - margin)); y <= Math.min(n - 1, Math.floor(by + margin)); y++) {
        const region = `${x}_${y}`;
        regions.add(region);
        let lines = pending.get(region);
        if (!lines) pending.set(region, (lines = []));
        lines.push(line);
        if (lines.length >= 2000) {
          flush(region, lines);
          pending.set(region, []);
        }
      }
    }
  });
  for (const [region, lines] of pending) if (lines.length) flush(region, lines);
  return count;
}

/** geojson-vt index of one input's features in one region, or null when it has none there. */
function indexRegion(pass, x, y) {
  const file = path.join(regionDir, `${pass.prefix}${x}_${y}`);
  if (!fs.existsSync(file)) return null;
  const features = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return geojsonvt({ type: 'FeatureCollection', features }, {
    maxZoom: pass.maxZ,
    indexMaxZoom: pass.minZ,
    indexMaxPoints: 0, // split fully down to minZ up front
    extent: EXTENT,
    buffer: BUFFER,
    tolerance: TOLERANCE,
  });
}

// Depth-first from the region's tile; finished subtrees are dropped from the geojson-vt caches to keep memory flat.
function walk(group, z, x, y) {
  // Ask every input that still reaches this zoom, so an input that only starts
  // deeper (the junction lanes) is not pruned away by an empty tile up here.
  const parts = [];
  let more = false;
  for (const pass of group) {
    if (z > pass.maxZ || !pass.index) continue;
    const tile = pass.index.getTile(z, x, y);
    if (!tile || tile.features.length === 0) continue;
    more = true;
    if (z >= pass.minZ) parts.push(tile);
  }
  if (!more) return;
  if (parts.length > 0) {
    const tile = parts.length === 1 ? parts[0] : { features: parts.flatMap(t => t.features) };
    const pbf = vtpbf.fromGeojsonVt({ [layer]: tile }, { version: 2, extent: EXTENT });
    const data = zlib.gzipSync(pbf);
    insert.run(z, x, (1 << z) - 1 - y, data); // MBTiles rows are TMS (y flipped)
    const s = (stats[z] ??= { tiles: 0, bytes: 0, max: 0 });
    s.tiles++;
    s.bytes += data.length;
    s.max = Math.max(s.max, data.length);
  }
  if (z < Math.max(...group.map(p => p.maxZ))) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(group, z + 1, x * 2 + dx, y * 2 + dy);
  }
  for (const pass of group) if (pass.index) delete pass.index.tiles[toID(z, x, y)];
}

const minZ = Math.min(...passes.map(p => p.minZ));
const maxZ = Math.max(...passes.map(p => p.maxZ));
const meta = {
  name: layer,
  format: 'pbf',
  type: 'overlay',
  minzoom: String(minZ),
  maxzoom: String(maxZ),
  bounds: bounds.map(v => v.toFixed(5)).join(','),
  center: `${((bounds[0] + bounds[2]) / 2).toFixed(5)},${((bounds[1] + bounds[3]) / 2).toFixed(5)},${minZ + 2}`,
  json: JSON.stringify({ vector_layers: [{ id: layer, fields, minzoom: minZ, maxzoom: maxZ }] }),
  generator: 'rigbuddy make-tiles.mjs',
};
const putMeta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) putMeta.run(k, v);
db.exec('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)');
db.close();
fs.renameSync(tmp, outFile);

for (const [z, s] of Object.entries(stats)) {
  console.log(`z${z}: ${s.tiles} tiles, max ${s.max} B, avg ${Math.round(s.bytes / s.tiles)} B`);
}
console.log(`${outFile}: ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);

function toID(z, x, y) {
  return ((1 << z) * y + x) * 32 + z; // geojson-vt's tile id
}

/** Web Mercator position in tiles of a zoom with n tiles per side (not rounded down). */
function tileFraction(lon, lat, n) {
  const x = ((lon + 180) / 360) * n;
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Widens box [west, south, east, north] by a geometry. */
function boxOf(g, box) {
  const visit = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < box[0]) box[0] = c[0];
      if (c[1] < box[1]) box[1] = c[1];
      if (c[0] > box[2]) box[2] = c[0];
      if (c[1] > box[3]) box[3] = c[1];
    } else c.forEach(visit);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach(sub => boxOf(sub, box));
  else visit(g.coordinates);
}

function extendBounds(g) {
  if (!g) return;
  const visit = c => {
    if (typeof c[0] === 'number') {
      bounds = [Math.min(bounds[0], c[0]), Math.min(bounds[1], c[1]), Math.max(bounds[2], c[0]), Math.max(bounds[3], c[1])];
    } else c.forEach(visit);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach(extendBounds);
  else visit(g.coordinates);
}
