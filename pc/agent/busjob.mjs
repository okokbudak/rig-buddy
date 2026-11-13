// The bus line being driven (bus DLC), from Rig Buddy's own telemetry plugin (pc/telemetry-plugin): it writes
// %LOCALAPPDATA%\Rig Buddy\live\<game>-bus.json whenever the game's "bus_job" configuration changes, e.g.
//   {"game":"ets2","written":1763000000000,"active":true,"job":{"bus.stages.count":"1","bus.stages.current":"0",
//    "income":"1977","planned_distance.km":"90","bus_job.market":"company_job","source_stop.type[0]":"city",
//    "source_stop.id[0]":"akureyri","source_stop.name[0]":"Akureyri","destination_stop.type[0]":"city",
//    "destination_stop.id[0]":"husavik","destination_stop.name[0]":"Húsavík",
//    "source_stop.departure_time.planned[0]":"3510","destination_stop.arrival_time.planned[0]":"3625",
//    "source_stop.entering_passengers.planned[0]":"26","destination_stop.leaving_passengers.planned[0]":"26"},
//    "event":{"id":"bus_job.completed","at":1763000000000,"attributes":{...}}}
// Each stage is one leg (stop to stop); bus.stages.current is the leg being driven. The stops get the road nodes of
// the map's bus stops (save.mjs defs: city stops and tourist viewpoints), so the app can route to the next one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const liveDir = () =>
  process.env.RIGBUDDY_LIVE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Rig Buddy', 'live');

const cache = new Map(); // file -> { mtimeMs, data }

/** The plugin's file for a game, parsed (cached by mtime), or null when there is none. */
export function readBusFile(game) {
  const file = path.join(liveDir(), `${game}-bus.json`);
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs, data });
    return data;
  } catch {
    return null; // no plugin (yet), or caught mid-write: next poll
  }
}

const int = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The app's view of the bus job in the plugin's file, or null without one. d: save.mjs defs() of the game (may be
 * null: no map data, then no nodes).
 */
export function busJobFrom(file, d) {
  if (!file?.active || !file.job) return null;
  const a = file.job;
  const count = int(a['bus.stages.count']) ?? 0;
  if (count <= 0) return null;
  const current = Math.min(Math.max(int(a['bus.stages.current']) ?? 0, 0), count);
  const where = (type, id) => {
    if (!d || !id) return null;
    if (type === 'city') return d.busStations?.get(id) ?? d.cityCentreNode?.get(id) ?? null;
    // a tourist stop: the viewpoint's album token ("viewpoints.blkwtirana"); the id may come with or without the prefix
    return d.viewpoints?.get(id) ?? d.viewpoints?.get(`viewpoints.${id}`) ?? d.busStations?.get(id) ?? null;
  };
  const stop = (side, i) => {
    const type = a[`${side}_stop.type[${i}]`] ?? '';
    const id = a[`${side}_stop.id[${i}]`] ?? '';
    const at = where(type, id);
    return {
      name: a[`${side}_stop.name[${i}]`] || at?.name || d?.cities?.get(id)?.name || id,
      type,
      id,
      nodeUid: at?.nodeUid != null ? String(at.nodeUid) : null,
      approx: at?.approx === true,
    };
  };
  const stages = [];
  for (let i = 0; i < count; i++) {
    stages.push({
      from: stop('source', i),
      to: stop('destination', i),
      departure: int(a[`source_stop.departure_time.planned[${i}]`]), // game minutes
      arrival: int(a[`destination_stop.arrival_time.planned[${i}]`]),
      entering: int(a[`source_stop.entering_passengers.planned[${i}]`]),
      leaving: int(a[`destination_stop.leaving_passengers.planned[${i}]`]),
    });
  }
  const leg = stages[current] ?? null; // null: past the last stage (arrived, the game is about to end the job)
  return {
    market: a['bus_job.market'] ?? '',
    tourist: stages.some(s => s.to.type !== 'city' || s.from.type !== 'city'),
    income: int(a.income),
    plannedKm: int(a['planned_distance.km']),
    stage: current,
    stages: count,
    source: stages[0].from.name,
    destination: stages.at(-1).to.name,
    next: leg
      ? { name: leg.to.name, nodeUid: leg.to.nodeUid, approx: leg.to.approx, arrival: leg.arrival, leaving: leg.leaving,
          departure: leg.departure, entering: leg.entering, from: leg.from.name }
      : null,
    // the rest of the line from the next stop on, for a route through all of them
    remaining: stages.slice(current).map(s => ({ name: s.to.name, nodeUid: s.to.nodeUid, arrival: s.arrival })),
  };
}
