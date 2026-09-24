// Builds the app's MBTiles (gzipped Mapbox Vector Tiles) from GeoJSON, in
// plain Node: replaces tippecanoe so the map can be built on Windows without
// WSL. Each input covers a zoom range and is tiled without dropping features
// (postprocess-geojson.js already split the map into low / high zoom sets).
// Inputs whose zoom ranges overlap share the tiles they both cover.
//
// usage: node make-tiles.mjs --layer ets2 --out ets2.mbtiles low.geojson:4:8 high.geojson:9:13
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

// the properties the app's map style reads (tippecanoe -y ...)
const ATTRS = ['type', 'roadType', 'color', 'hidden', 'width', 'poiType', 'sprite', 'scaleRank', 'capital', 'name'];
const EXTENT = 4096;
const BUFFER = 160; // tippecanoe -b 10 (screen pixels of a 256 px tile) in tile units
// How hard lines are simplified before they go into a tile. geojson-vt's
// default (3) drops a fifth of the roads at low zoom, which tears the network
// apart; 0.5 keeps the detail tippecanoe used to give (~5% larger tiles).
// RIGBUDDY_TILE_TOLERANCE is there to try other values.
const TOLERANCE = Number(process.env.RIGBUDDY_TILE_TOLERANCE ?? 0.5);

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
 * Reads a GeoJSON FeatureCollection without ever holding it as one string: V8
 * cannot make a string over ~512 MB, and the road surfaces (with map mods) are
 * bigger than that. Scans the bytes for the "features" array and parses one
 * feature at a time; small files take the plain JSON.parse route.
 */
function readFeatureCollection(file) {
  if (fs.statSync(file).size < 300 * 1024 * 1024) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(32 * 1024 * 1024);
  const features = [];
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
          features.push(JSON.parse(Buffer.concat(pieces).toString('utf8')));
          pieces = [];
          phase = 2;
        }
      }
      if (phase === 3) pieces.push(Buffer.from(buf.subarray(start, n)));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { type: 'FeatureCollection', features };
}

const fields = {};
let bounds = [180, 90, -180, -90];
const stats = {};
const started = Date.now();

// One index per input; they are walked together below.
for (const pass of passes) {
  const gj = readFeatureCollection(pass.file);
  for (const f of gj.features) {
    const p = {};
    for (const k of ATTRS) {
      const v = f.properties?.[k];
      if (v === undefined || v === null) continue;
      p[k] = v;
      fields[k] ??= typeof v === 'number' ? 'Number' : typeof v === 'boolean' ? 'Boolean' : 'String';
    }
    f.properties = p;
    extendBounds(f.geometry);
  }
  pass.index = geojsonvt(gj, {
    maxZoom: pass.maxZ,
    indexMaxZoom: pass.minZ,
    indexMaxPoints: 0, // split fully down to minZ up front
    extent: EXTENT,
    buffer: BUFFER,
    tolerance: TOLERANCE,
  });
  gj.features = null; // let the GeoJSON go; geojson-vt keeps its own copy
}

// Depth-first from the lowest zoom any input starts at; finished subtrees are
// dropped from the geojson-vt caches to keep memory flat.
const top = Math.min(...passes.map(p => p.minZ));
const deepest = Math.max(...passes.map(p => p.maxZ));
const n = 1 << top;
const [x0, y1] = tileOf(bounds[0], bounds[1], top);
const [x1, y0] = tileOf(bounds[2], bounds[3], top);
db.exec('BEGIN');
for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) {
  for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) walk(top, x, y);
}
db.exec('COMMIT');

function walk(z, x, y) {
  // Ask every input that still reaches this zoom, so an input that only starts
  // deeper (the junction lanes) is not pruned away by an empty tile up here.
  const parts = [];
  let more = false;
  for (const pass of passes) {
    if (z > pass.maxZ) continue;
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
  if (z < deepest) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(z + 1, x * 2 + dx, y * 2 + dy);
  }
  for (const pass of passes) delete pass.index.tiles[toID(z, x, y)];
}

const minZ = top;
const maxZ = deepest;
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

function tileOf(lon, lat, z) {
  const n = 1 << z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
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
