// Tests pc/agent/busjob.mjs: the bus job file of pc/telemetry-plugin -> what the app gets. The job is the one ETS2 1.62
// sent for a line Akureyri > Húsavík; the stop places are made up (no map data needed).
//   node dev/test-busjob.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-live-'));
process.env.RIGBUDDY_LIVE = dir;
const { busJobFrom, readBusFile } = await import('../pc/agent/busjob.mjs');

const job = {
  'bus.stages.count': '1', 'bus.stages.current': '0', income: '1977', 'planned_distance.km': '90',
  'bus_job.market': 'company_job', 'source_stop.type[0]': 'city', 'source_stop.id[0]': 'akureyri',
  'source_stop.name[0]': 'Akureyri', 'destination_stop.type[0]': 'city', 'destination_stop.id[0]': 'husavik',
  'destination_stop.name[0]': 'Húsavík', 'source_stop.departure_time.planned[0]': '3510',
  'destination_stop.arrival_time.planned[0]': '3625', 'source_stop.entering_passengers.planned[0]': '26',
  'destination_stop.leaving_passengers.planned[0]': '26',
};
const d = {
  busStations: new Map([['husavik', { nodeUid: '5489de1bb3ae0002' }], ['akureyri', { nodeUid: '510ecbc9b5050000' }]]),
  cityCentreNode: new Map([['reykjavik', { nodeUid: '1', approx: true }]]),
  viewpoints: new Map([['viewpoints.isgullfoss', { nodeUid: 'abc', name: 'Gullfoss' }]]),
  cities: new Map(),
};

// no file yet, then the plugin's file
assert.equal(readBusFile('ets2'), null);
fs.writeFileSync(path.join(dir, 'ets2-bus.json'), JSON.stringify({ game: 'ets2', written: 1, active: true, job }));
const file = readBusFile('ets2');
const b = busJobFrom(file, d);
assert.equal(b.source, 'Akureyri');
assert.equal(b.destination, 'Húsavík');
assert.equal(b.income, 1977);
assert.equal(b.plannedKm, 90);
assert.equal(b.tourist, false);
assert.deepEqual(b.next, { name: 'Húsavík', nodeUid: '5489de1bb3ae0002', approx: false, arrival: 3625, leaving: 26, departure: 3510, entering: 26, from: 'Akureyri' });
assert.equal(b.remaining.length, 1);

// no job: active false, or no attributes
assert.equal(busJobFrom({ active: false, job: {} }, d), null);
assert.equal(busJobFrom({ active: true, job: {} }, d), null);

// a tourist line in two stages, on the second: the viewpoint is behind, the next stop is the city again
const tour = {
  'bus.stages.count': '2', 'bus.stages.current': '1',
  'source_stop.type[0]': 'city', 'source_stop.id[0]': 'reykjavik', 'source_stop.name[0]': 'Reykjavík',
  'destination_stop.type[0]': 'viewpoint', 'destination_stop.id[0]': 'isgullfoss', 'destination_stop.name[0]': 'Gullfoss',
  'source_stop.type[1]': 'viewpoint', 'source_stop.id[1]': 'isgullfoss', 'source_stop.name[1]': 'Gullfoss',
  'destination_stop.type[1]': 'city', 'destination_stop.id[1]': 'reykjavik', 'destination_stop.name[1]': 'Reykjavík',
};
const t = busJobFrom({ active: true, job: tour }, d);
assert.equal(t.tourist, true);
assert.equal(t.next.name, 'Reykjavík');
assert.equal(t.next.nodeUid, '1');
assert.equal(t.next.approx, true);
assert.equal(busJobFrom({ active: true, job: { ...tour, 'bus.stages.current': '0' } }, d).next.nodeUid, 'abc');
// past the last stage (arrived): no next stop
assert.equal(busJobFrom({ active: true, job: { ...tour, 'bus.stages.current': '2' } }, d).next, null);
// no map data: names without nodes
assert.equal(busJobFrom({ active: true, job }, null).next.nodeUid, null);

fs.rmSync(dir, { recursive: true, force: true });
console.log('busjob: all tests passed');
