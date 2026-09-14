// Prints a few jobs and one telemetry frame from the agent.
import { createRequire } from 'node:module';
// resolve 'ws' from the agent's dependencies (pc/agent/node_modules)
const WebSocket = createRequire(new URL('../pc/agent/package.json', import.meta.url))('ws');
const base = 'http://localhost:62843';
const jobs = await (await fetch(`${base}/jobs?limit=5`)).json();
console.log('jobs:', jobs.jobs?.length, 'currency', jobs.currency);
for (const j of jobs.jobs ?? []) {
  console.log(` ${j.pickupKm} km away | ${j.source.company} (${j.source.city}) -> ${j.destination.company} (${j.destination.city}) | ${j.cargo} ${j.cargoMassT}t | ${j.distanceKm} km | ~${j.estimatedIncome} | expires ${j.expiresInMin} min | quick=${j.quickJob} | nodes ${j.source.nodeUid}->${j.destination.nodeUid}`);
}
const ws = new WebSocket('ws://localhost:62843/ws');
ws.on('message', m => {
  const msg = JSON.parse(m);
  if (msg.type === 'telemetry' && msg.data) {
    const t = msg.data;
    console.log('telemetry:', JSON.stringify({ truck: { brand: t.truck.brand, model: t.truck.model, speed: t.truck.speedKph, rpm: t.truck.rpm, gear: t.truck.gear, fuel: t.truck.fuel, damage: t.truck.damage, lights: t.truck.lights }, job: t.job, nav: t.navigation }).slice(0, 900));
    process.exit(0);
  }
});
setTimeout(() => { console.log('no telemetry frame'); process.exit(0); }, 4000);
