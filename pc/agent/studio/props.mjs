// The properties formulas can read: everything the scs-sdk-plugin exposes
// (trucksim-telemetry's parsed buffer: game, truck, trailer(s), job,
// navigation, controls), plus a few computed ones under `x.`.
// static imports (not require()): the release bundle (setup/bundle.mjs) has no node_modules to resolve at run time
import convert from 'trucksim-telemetry/lib/converter/index.js';
import parseData from 'trucksim-telemetry/lib/parser/parseData.js';
import { lookup } from './expr.mjs';

/** Computed properties and unit constants, readable as x.<name>. */
const EXTRAS = {
  gameRunning: raw => raw != null,
  psiToBar: () => 0.0689476,
  kphToMph: () => 0.621371,
  fuelPercent: raw => (raw?.truck?.fuel?.capacity > 0 ? (raw.truck.fuel.value / raw.truck.fuel.capacity) * 100 : 0),
  adBluePercent: raw => (raw?.truck?.adBlue?.capacity > 0 ? (raw.truck.adBlue.value / raw.truck.adBlue.capacity) * 100 : 0),
  rpmPercent: raw => (raw?.truck?.engine?.rpm?.max > 0 ? (raw.truck.engine.rpm.value / raw.truck.engine.rpm.max) * 100 : 0),
  airBar: raw => (raw?.truck?.brakes?.airPressure?.value ?? 0) * 0.0689476,
};
const EXTRA_INFO = {
  gameRunning: 'true while the game (with the telemetry plugin) is running',
  psiToBar: 'constant: multiply psi by this to get bar',
  kphToMph: 'constant',
  fuelPercent: 'fuel tank level, 0-100',
  adBluePercent: 'AdBlue tank level, 0-100',
  rpmPercent: 'engine rpm as % of the rev limit',
  airBar: 'brake air pressure in bar',
};

/** Value of a path (or undefined): the raw telemetry, then x.* extras. */
export function read(raw, path) {
  if (path.startsWith('x.')) {
    const f = EXTRAS[path.slice(2)];
    return f ? f(raw) : undefined;
  }
  return raw == null ? undefined : lookup(raw, path);
}

function flatten(o, prefix, out) {
  if (o === null || typeof o !== 'object') {
    out.push([prefix, o]);
    return;
  }
  if (Array.isArray(o)) {
    o.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return;
  }
  for (const k of Object.keys(o)) flatten(o[k], prefix ? `${prefix}.${k}` : k, out);
}

/** [[path, value], ...] of a telemetry object. */
export function flattenTelemetry(raw) {
  const out = [];
  flatten(raw, '', out);
  return out;
}

let catalogCache = null;

/**
 * Every readable path with its type, taken from the plugin's data layout
 * (an all-zero buffer parsed as plugin v12), so it is complete before the game starts.
 */
export function catalog() {
  if (catalogCache) return catalogCache;
  const zero = parseData(convert.converter(12, Buffer.alloc(32768)));
  const list = flattenTelemetry(zero).map(([path, v]) => ({ path, kind: typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : 'text' }));
  for (const name of Object.keys(EXTRAS)) {
    const v = EXTRAS[name](null);
    list.push({ path: `x.${name}`, kind: typeof v === 'boolean' ? 'bool' : 'number', info: EXTRA_INFO[name] });
  }
  return (catalogCache = list);
}
