// Builds Rig Buddy's map, route and game data from the user's own ETS2 / ATS
// files, natively on Windows (no WSL): tm-maps parser + generator, then
// postprocess-geojson.js and make-tiles.mjs. Games are skipped when their
// installation hasn't changed since the last build (unless --force).
//
// usage: node build-map-data.mjs --tm <tm-maps> --data <data dir> --work <work dir>
//                                [--ets2 <game dir>] [--ats <game dir>] [--force] [--check]
//
// --check only reports, per game, whether a (re)build is needed ("@@needs <game> yes|no").
// Progress for RigBuddy.exe: lines "@@progress <0-100> <stage key> [arg]", each followed by
// "@@expect <percent at the end of the step> <usual seconds>" so the bar can move within a step.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, ZipDeflate } from 'fflate';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const TM = path.resolve(opt('--tm') ?? path.join(HERE, '../vendor/tm-maps'));
const DATA = path.resolve(opt('--data') ?? path.join(HERE, '../data'));
const WORK = path.resolve(opt('--work') ?? path.join(HERE, '../local/map-build'));
const PARSER_OUT = path.join(WORK, 'parser');
const HEAP = '--max-old-space-size=8192';
// release layout (setup/bundle.mjs): dist/pipeline next to dist/parser, dist/generator, dist/resources
const BUNDLED = fs.existsSync(path.join(HERE, '../parser/index.mjs'));
const RESOURCES = BUNDLED ? path.join(HERE, '../resources') : path.join(TM, 'packages/clis/generator/resources');

const games = [
  { game: 'ets2', map: 'europe', name: 'ETS2', dir: opt('--ets2') },
  { game: 'ats', map: 'usa', name: 'ATS', dir: opt('--ats') },
].filter(g => g.dir && fs.existsSync(path.join(g.dir, 'base.scs')));
if (!games.length) fail('no game folder given (--ets2 / --ats) or base.scs not found');

// what goes into <map>-navigation.zip (tm-maps Makefile, NAVIGATION_FILES)
const PARSER_JSON = ['countries', 'companyDefs', 'roadLooks', 'prefabDescriptions', 'modelDescriptions',
  'signDescriptions', 'cargoes', 'achievements', 'routes', 'mileageTargets', 'nodes', 'elevation', 'roads',
  'ferries', 'prefabs', 'companies', 'models', 'mapAreas', 'pois', 'dividers', 'trajectories', 'triggers',
  'signs', 'cutscenes', 'cities'];
const GAME_JSON = ['cities', 'companies', 'companyDefs', 'cargoes', 'countries']; // for pc/agent

/** Fingerprint of an installation: every .scs archive (base, DLCs, map packs) by name, size and date. */
function fingerprint(dir) {
  const h = crypto.createHash('sha1');
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name.toLowerCase() === 'dlc') walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.scs')) {
        const st = fs.statSync(p);
        h.update(`${path.relative(dir, p)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

const stampFile = g => path.join(DATA, `${g.game}.stamp`);
const needsBuild = g =>
  flag('--force') ||
  !fs.existsSync(path.join(DATA, `${g.map}-navigation.zip`)) ||
  !fs.existsSync(path.join(DATA, `${g.game}.mbtiles`)) ||
  (fs.existsSync(stampFile(g)) ? fs.readFileSync(stampFile(g), 'utf8').trim() : '') !== fingerprint(g.dir);

// data from before the app icon sheet existed (cheap, so also on --check)
if (!fs.existsSync(path.join(DATA, 'sprites/app.png')) && fullSpriteSheet()) writeAppSprites();

if (flag('--check')) {
  for (const g of games) console.log(`@@needs ${g.game} ${needsBuild(g) ? 'yes' : 'no'}`);
  process.exit(0);
}

const todo = games.filter(needsBuild);
if (!todo.length) {
  progress(100, 'map.uptodate');
  process.exit(0);
}
fs.mkdirSync(PARSER_OUT, { recursive: true });
fs.mkdirSync(path.join(DATA, 'game'), { recursive: true });

// progress: each game gets an equal share, split over its steps by typical duration
const STEPS = { parse: 40, labels: 2, search: 5, graph: 20, roundabouts: 3, zip: 5, geojson: 15, postprocess: 5, tiles: 4, copy: 1 };
// seconds per step weight (measured: ETS2 with all map DLCs ~4.5 min, ATS ~3 min)
const SECONDS_PER_WEIGHT = { ets2: 2.9, ats: 1.9 };
const STEP_TOTAL = Object.values(STEPS).reduce((a, b) => a + b, 0);
let doneWeight = 0;
const totalWeight = todo.length * STEP_TOTAL + 2; // + spritesheet
const step = (key, g) => {
  progress(Math.floor((doneWeight / totalWeight) * 100), `map.${key}`, g?.name ?? '');
  const weight = key === 'sprites' ? 2 : STEPS[key];
  doneWeight += weight;
  console.log(`@@expect ${Math.floor((doneWeight / totalWeight) * 100)} ${(weight * (SECONDS_PER_WEIGHT[g?.game] ?? 3)).toFixed(0)}`);
};

for (const g of todo) {
  const started = Date.now();
  // parser output is per game (europe-* / usa-*); stale files of this game go first
  for (const f of fs.readdirSync(PARSER_OUT)) if (f.startsWith(`${g.map}-`)) fs.rmSync(path.join(PARSER_OUT, f));

  step('parse', g);
  tm('parser', ['-i', g.dir, '-o', PARSER_OUT]);

  step('labels', g);
  const labels = path.join(WORK, 'extra-labels.geojson');
  if (g.map === 'usa') {
    tm('generator', ['extra-labels', '-m', 'usa', '-t', BUNDLED ? path.join(RESOURCES, 'usa-labels-meta.json') : path.join(HERE, 'resources/usa-labels-meta.json'), '-i', PARSER_OUT, '-o', WORK]);
  } else if (!fs.existsSync(labels) || !games.some(x => x.map === 'usa')) {
    // US town labels only matter for ATS; ETS2's zip gets an empty set
    fs.writeFileSync(labels, '{"type":"FeatureCollection","features":[]}');
  }

  step('search', g);
  tm('generator', ['search', '-m', g.map, '-i', PARSER_OUT, '-o', WORK, ...(g.map === 'usa' ? ['-x', labels] : [])]);
  step('graph', g);
  tm('generator', ['graph', '-m', g.map, '-i', PARSER_OUT, '-o', WORK]);
  step('roundabouts', g);
  if (g.map === 'europe') tm('generator', ['roundabouts', '-m', 'europe', '-i', PARSER_OUT, '-g', WORK, '-o', WORK]);

  step('zip', g);
  const zipFiles = [
    ...PARSER_JSON.map(n => path.join(PARSER_OUT, `${g.map}-${n}.json`)),
    labels,
    path.join(WORK, `${g.game}-search.geojson`),
    path.join(WORK, `${g.map}-graph.json`),
    ...(g.map === 'europe' ? [path.join(WORK, 'europe-roundabouts.json')] : []),
  ];
  await writeZip(path.join(DATA, `${g.map}-navigation.zip`), zipFiles);

  step('geojson', g);
  tm('generator', ['map', '-h', '-m', g.map, '-i', PARSER_OUT, '-o', WORK,
    '--dataOverridesPath', path.join(RESOURCES, 'trucksim-overrides.json'), '-t', 'geojson']);
  step('postprocess', g);
  node([path.join(HERE, BUNDLED ? 'postprocess-geojson.cjs' : 'postprocess-geojson.js'), path.join(WORK, `${g.game}.geojson`), path.join(WORK, `${g.game}-nav.geojson`)]);
  step('tiles', g);
  node([path.join(HERE, 'make-tiles.mjs'), '--layer', g.game, '--out', path.join(DATA, `${g.game}.mbtiles`),
    `${path.join(WORK, `${g.game}-nav-low.geojson`)}:4:8`, `${path.join(WORK, `${g.game}-nav-high.geojson`)}:9:13`]);

  step('copy', g);
  for (const n of GAME_JSON) fs.copyFileSync(path.join(PARSER_OUT, `${g.map}-${n}.json`), path.join(DATA, 'game', `${g.map}-${n}.json`));
  fs.writeFileSync(stampFile(g), fingerprint(g.dir));
  console.log(`${g.name} done in ${Math.round((Date.now() - started) / 1000)} s`);
}

step('sprites');
fs.mkdirSync(path.join(DATA, 'sprites'), { recursive: true });
tm('generator', ['spritesheet', ...games.flatMap(g => ['-m', g.map]), '-i', PARSER_OUT, '-o', WORK]);
for (const f of ['sprites@2x.json', 'sprites@2x.png']) fs.copyFileSync(path.join(WORK, f), path.join(DATA, 'sprites', f));
writeAppSprites();

// the scratch files are ~1.5 GB; keep only what the spritesheet of a later
// one-game rebuild needs from the other game (its POIs and the icons)
for (const e of fs.readdirSync(WORK, { withFileTypes: true })) {
  if (e.isFile()) fs.rmSync(path.join(WORK, e.name));
}
for (const e of fs.readdirSync(PARSER_OUT, { withFileTypes: true })) {
  if (e.isFile() && !e.name.endsWith('-pois.json')) fs.rmSync(path.join(PARSER_OUT, e.name));
}

progress(100, 'map.done');

// --- helpers -----------------------------------------------------------------------------

function progress(pct, key, arg = '') {
  console.log(`@@progress ${pct} ${key}${arg ? ' ' + arg : ''}`);
}

function fail(msg) {
  console.error(`@@error ${msg}`);
  process.exit(1);
}

/** Runs a tm-maps CLI: the bundled build in a release, else from source through tsx. */
function tm(name, cliArgs) {
  const entry = BUNDLED
    ? [path.join(HERE, '..', name, 'index.mjs')]
    : [path.join(TM, 'node_modules/tsx/dist/cli.mjs'), path.join(TM, 'packages/clis', name, 'index.ts')];
  node([...entry, ...cliArgs], path.join(TM, 'packages/clis', name));
}

function node(nodeArgs, cwd = HERE) {
  console.log(`> ${path.basename(nodeArgs[nodeArgs[0].endsWith('cli.mjs') ? 1 : 0])} ${nodeArgs.slice(1).filter(a => !a.endsWith('index.ts')).join(' ')}`);
  const r = spawnSync(process.execPath, [HEAP, ...nodeArgs], {
    cwd: fs.existsSync(cwd) ? cwd : HERE,
    stdio: 'inherit',
    // NODE_OPTIONS, not just argv: tsx runs the CLI in a child node process
    env: { ...process.env, NODE_OPTIONS: HEAP, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (r.status !== 0) fail(`${path.basename(nodeArgs[0])} exited with ${r.status ?? r.signal}`);
}

/**
 * data/sprites/app.{json,png}: only the icons the app's map style uses (the
 * full sheet is ~21 MB of GPU texture). The app downloads it from the agent;
 * the icons are the game's own, so they come from the user's files, not the APK.
 */
/** The generator's full sheet in data/sprites (named sprites.* by older builds), or null. */
function fullSpriteSheet() {
  for (const name of ['sprites@2x', 'sprites']) {
    const base = path.join(DATA, 'sprites', name);
    if (fs.existsSync(`${base}.png`) && fs.existsSync(`${base}.json`)) return base;
  }
  return null;
}

function writeAppSprites() {
  const ICONS = ['gas_ico', 'service_ico', 'parking_ico', 'dealer_ico', 'garage_large_ico', 'recruitment_ico',
    'weigh_station_ico', 'weigh_ico', 'toll_ico', 'border_ico', 'dot', 'dotdot', 'roadwork', 'railcrossing',
    'viewpoint', 'port_overlay', 'train_ico'];
  const dir = path.join(DATA, 'sprites');
  const full = fullSpriteSheet();
  const index = JSON.parse(fs.readFileSync(`${full}.json`, 'utf8'));
  const sheet = PNG.sync.read(fs.readFileSync(`${full}.png`));
  const picked = ICONS.filter(n => index[n] || void console.log(`missing sprite: ${n}`));
  // shelf packing, 512 px wide
  const WIDTH = 512;
  let x = 0, y = 0, rowH = 0;
  const placed = picked.map(name => {
    const e = index[name];
    if (x + e.width > WIDTH) { x = 0; y += rowH + 1; rowH = 0; }
    const p = { name, e, x, y };
    x += e.width + 1;
    rowH = Math.max(rowH, e.height);
    return p;
  });
  const out = new PNG({ width: WIDTH, height: y + rowH });
  const json = {};
  for (const { name, e, x, y } of placed) {
    PNG.bitblt(sheet, out, e.x, e.y, e.width, e.height, x, y);
    json[name] = { x, y, width: e.width, height: e.height, pixelRatio: e.pixelRatio };
  }
  fs.writeFileSync(path.join(dir, 'app.png'), PNG.sync.write(out));
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(json, null, 1));
  console.log(`app icon sheet: ${placed.length} icons, ${WIDTH}x${y + rowH}`);
}

/** Streams files into a deflate zip, flat (like `zip -j`): the server looks entries up by basename. */
function writeZip(out, files) {
  return new Promise((resolve, reject) => {
    const tmp = `${out}.part`;
    const fd = fs.openSync(tmp, 'w');
    const zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      fs.writeSync(fd, chunk);
      if (final) {
        fs.closeSync(fd);
        fs.renameSync(tmp, out);
        resolve();
      }
    });
    for (const f of files) {
      const entry = new ZipDeflate(path.basename(f), { level: 6 });
      zip.add(entry);
      const buf = Buffer.alloc(4 << 20);
      const rfd = fs.openSync(f, 'r');
      let n;
      while ((n = fs.readSync(rfd, buf, 0, buf.length, null)) > 0) entry.push(buf.subarray(0, n));
      fs.closeSync(rfd);
      entry.push(new Uint8Array(0), true);
    }
    zip.end();
  });
}
