// Bundles the Node side of Rig Buddy with esbuild into <repo>/dist, so a
// release needs only node.exe + dist (no node_modules, no tsx at runtime):
//
//   dist/server/index.mjs        navigation server (tm-maps apis/navigation)
//   dist/workers/*.js            its tinypool workers (paths as the server expects)
//   dist/navigator/index.mjs     telemetry client (tm-maps clis/navigator)
//   dist/agent/index.mjs         pc/agent
//   dist/parser/index.mjs        game file parser (+ cityhash.node, gdeflate.node)
//   dist/generator/index.mjs     map/graph/search generator
//   dist/resources/              generator resources (overrides, labels, places)
//   dist/pipeline/               build-map-data.mjs, make-tiles.mjs, postprocess-geojson.js
//   dist/THIRD-PARTY-LICENSES.txt  licenses of everything bundled in
//
// usage: vendor\node\node.exe setup\bundle.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TM = path.join(ROOT, 'vendor/tm-maps');
const DIST = path.join(ROOT, 'dist');
const esbuild = createRequire(path.join(TM, 'package.json'))('esbuild');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'package.json'), '{ "type": "module", "private": true }\n');

// the JS stand-in for trucksim-telemetry's native addon (reads RigBuddy.exe's bridge)
const shim = path.join(ROOT, 'pc/patches/scsSDKTelemetry.js');
for (const nm of [path.join(TM, 'node_modules'), path.join(ROOT, 'pc/agent/node_modules')]) {
  const dir = path.join(nm, 'trucksim-telemetry/build/Release');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(shim, path.join(dir, 'scsSDKTelemetry.js'));
}

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  legalComments: 'none',
  // CommonJS dependencies call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  loader: { '.node': 'copy' },
  metafile: true,
};

// every source file that went into a bundle, for THIRD-PARTY-LICENSES.txt
const inputs = new Set();
const build = async options => {
  const result = await esbuild.build(options);
  for (const file of Object.keys(result.metafile.inputs)) inputs.add(path.resolve(file)); // relative to the cwd
  return result;
};

// parser: scs-archive.ts loads its addons at run time with
// createRequire(import.meta.url)('bindings')('cityhash'), which looks in the
// package's build/Release. In the bundle the addons sit next to index.mjs.
const bindingsNextToBundle = {
  name: 'bindings-next-to-bundle',
  setup(build) {
    build.onLoad({ filter: /scs-archive\.ts$/ }, args => {
      const src = fs.readFileSync(args.path, 'utf8');
      const out = src.replace(/require\((['"])bindings\1\)\((['"])(\w+)\2\)/g, "require('./$3.node')");
      if (out === src) throw new Error('bindings() call not found in scs-archive.ts');
      return { contents: out, loader: 'ts' };
    });
  },
};

// tinypool starts its threads from `${import.meta.url}/../entry/worker.js`,
// i.e. next to whatever file contains it, and that file imports tinypool's
// shared chunks from one level up: copy its runtime next to such bundles.
const TINYPOOL_DIST = path.dirname(createRequire(path.join(TM, 'package.json')).resolve('tinypool'));
function copyTinypoolRuntime(dir) {
  fs.cpSync(TINYPOOL_DIST, dir, { recursive: true, filter: src => !src.endsWith('.d.ts') && src !== path.join(TINYPOOL_DIST, 'index.js') });
}

async function bundle(name, entry, extra = {}) {
  const outfile = path.join(DIST, name, 'index.mjs');
  const result = await build({ ...common, entryPoints: [entry], outfile, ...extra });
  if (Object.keys(result.metafile.inputs).some(p => /node_modules[\\/]tinypool[\\/]/.test(p))) copyTinypoolRuntime(path.dirname(outfile));
  console.log(`${path.relative(ROOT, outfile)}  ${(fs.statSync(outfile).size / 1e6).toFixed(1)} MB`);
}

await bundle('server', path.join(TM, 'packages/apis/navigation/index.ts'));

// workers: same exports as the tsx-based wrappers, with the worker code inlined
const workersDir = path.join(TM, 'packages/apis/navigation/infra/workers');
const workers = {
  'find-route-worker-wrapper.js':
    "import { workerData as t } from 'node:worker_threads'; import run from './find-route-worker.ts';" +
    'const [, wd] = t; export default function findRoutesWithContext(o) { return run({ ...o, routeContext: wd.routeContext }); }',
  'search-worker-wrapper.js':
    "import { workerData as t } from 'node:worker_threads'; import run from './search-worker.ts';" +
    'const [, wd] = t; export default function searchWithRTree(o) { return run({ ...o, rbushJSON: wd.rbushJSON }); }',
  'search-results-worker-wrapper.js':
    "import run from './search-results-worker.ts'; export default function reduceResults(o) { return run(o); }",
};
for (const [file, contents] of Object.entries(workers)) {
  await build({
    ...common,
    stdin: { contents, resolveDir: workersDir, loader: 'ts', sourcefile: file },
    outfile: path.join(DIST, 'workers', file),
  });
}
console.log(`dist/workers  ${Object.keys(workers).length} workers`);

await bundle('navigator', path.join(TM, 'packages/clis/navigator/index.ts'));
await bundle('agent', path.join(ROOT, 'pc/agent/index.mjs'));
await bundle('parser', path.join(TM, 'packages/clis/parser/index.ts'), { plugins: [bindingsNextToBundle] });
for (const f of ['cityhash.node', 'gdeflate.node']) {
  fs.copyFileSync(path.join(ROOT, 'pc/native/win-x64', f), path.join(DIST, 'parser', f));
}
await bundle('generator', path.join(TM, 'packages/clis/generator/index.ts'));

// generator resources: its code reads <bundle dir>/../resources
fs.cpSync(path.join(TM, 'packages/clis/generator/resources'), path.join(DIST, 'resources'), {
  recursive: true,
  filter: src => !src.includes(`${path.sep}extra-labels${path.sep}`), // the CSV sources; meta JSON below
});
fs.copyFileSync(path.join(ROOT, 'pipeline/resources/usa-labels-meta.json'), path.join(DIST, 'resources/usa-labels-meta.json'));

// the map pipeline itself (its npm deps bundled in)
await bundle('pipeline', path.join(ROOT, 'pipeline/build-map-data.mjs'));
fs.renameSync(path.join(DIST, 'pipeline/index.mjs'), path.join(DIST, 'pipeline/build-map-data.mjs'));
await build({ ...common, entryPoints: [path.join(ROOT, 'pipeline/make-tiles.mjs')], outfile: path.join(DIST, 'pipeline/make-tiles.mjs') });
await build({ ...common, format: 'cjs', banner: {}, entryPoints: [path.join(ROOT, 'pipeline/postprocess-geojson.js')], outfile: path.join(DIST, 'pipeline/postprocess-geojson.cjs') });

writeLicenses(path.join(DIST, 'THIRD-PARTY-LICENSES.txt'));

/** The npm packages the bundles contain (by the node_modules folders of their inputs), with their license texts. */
function writeLicenses(out) {
  const pkgs = new Map();
  for (const file of inputs) {
    const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(file);
    if (m && !pkgs.has(m[1]) && fs.existsSync(path.join(m[1], 'package.json'))) pkgs.set(m[1], null);
  }
  const seen = new Set();
  const parts = [];
  for (const dir of [...pkgs.keys()].sort()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const licenseFile = fs.readdirSync(dir).find(n => /^(licen[sc]e|copying)(\.|$)/i.test(n));
    const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : `(no license file; package.json says: ${JSON.stringify(pkg.license ?? 'unknown')})`;
    parts.push(`${id}  (${typeof pkg.license === 'string' ? pkg.license : 'see below'})\n${'-'.repeat(72)}\n${text}`);
  }
  const header = [
    'Rig Buddy bundles the following software. Rig Buddy itself: GPL-3.0-or-later, see LICENSE.',
    'The navigation server, parser and map generator are built from truckermudgeon/maps',
    '(https://github.com/truckermudgeon/maps), GPL-3.0; its source and the patches Rig Buddy',
    'applies are in the Rig Buddy repository (pc/patches/tm-maps).',
  ].join('\n');
  fs.writeFileSync(out, [header, ...parts].join(`\n\n${'='.repeat(72)}\n\n`) + '\n');
  console.log(`${path.relative(ROOT, out)}  ${seen.size} packages`);
}

const size = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).reduce((s, e) => s + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
console.log(`dist total ${(size(DIST) / 1e6).toFixed(1)} MB`);
