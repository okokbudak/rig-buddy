// Builds the app's MBTiles (gzipped Mapbox Vector Tiles) from GeoJSON, in
// plain Node: replaces tippecanoe so the map can be built on Windows without
// WSL. Each input covers a zoom range and is tiled without dropping features
// (postprocess-geojson.js already split the map into low / high zoom sets).
//
// usage: node make-tiles.mjs --layer ets2 --out ets2.mbtiles low.geojson:4:8 high.geojson:9:13
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

// the properties the app's map style reads (tippecanoe -y ...)
const ATTRS = ['type', 'roadType', 'color', 'hidden', 'poiType', 'sprite', 'scaleRank', 'capital', 'name'];
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

const fields = {};
let bounds = [180, 90, -180, -90];
const stats = {};
const started = Date.now();

for (const pass of passes) {
  const gj = JSON.parse(fs.readFileSync(pass.file, 'utf8'));
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
  const index = geojsonvt(gj, {
    maxZoom: pass.maxZ,
    indexMaxZoom: pass.minZ,
    indexMaxPoints: 0, // split fully down to minZ up front
    extent: EXTENT,
    buffer: BUFFER,
    tolerance: TOLERANCE,
  });
  gj.features = null; // let the GeoJSON go; geojson-vt keeps its own copy

  // Depth-first from the non-empty tiles at minZ; finished subtrees are
  // dropped from geojson-vt's cache to keep memory flat.
  const n = 1 << pass.minZ;
  const [x0, y1] = tileOf(bounds[0], bounds[1], pass.minZ);
  const [x1, y0] = tileOf(bounds[2], bounds[3], pass.minZ);
  db.exec('BEGIN');
  for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) {
    for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) walk(index, pass, pass.minZ, x, y);
  }
  db.exec('COMMIT');
}

function walk(index, pass, z, x, y) {
  const tile = index.getTile(z, x, y);
  if (!tile || tile.features.length === 0) return;
  const pbf = vtpbf.fromGeojsonVt({ [layer]: tile }, { version: 2, extent: EXTENT });
  const data = zlib.gzipSync(pbf);
  insert.run(z, x, (1 << z) - 1 - y, data); // MBTiles rows are TMS (y flipped)
  const s = (stats[z] ??= { tiles: 0, bytes: 0, max: 0 });
  s.tiles++;
  s.bytes += data.length;
  s.max = Math.max(s.max, data.length);
  if (z < pass.maxZ) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(index, pass, z + 1, x * 2 + dx, y * 2 + dy);
  }
  delete index.tiles[toID(z, x, y)];
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
