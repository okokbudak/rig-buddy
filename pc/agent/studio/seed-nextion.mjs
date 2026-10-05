// The Scania R cluster on a Nextion NX4827T043 (480x272), as it ran in SimHub's Nextion
// plugin (template "Scania Dashboard\Scania_R"): pages 1, 3, 4, 5 and the bottom-strip
// touch hotspots, with each SimHub formula rewritten for Studio's property names.
// Disabled until a port is chosen: SimHub's Nextion display must not use the port at the same time.
const B = (target, expr, decimals = null) => ({ target, expr, decimals });

// the turn-signal arrows and the clock are on every page
const header = page => [
  B(`${page}.pblinkl.vis`, 'truck.lights.blinker.left.enabled'),
  B(`${page}.pblinkr.vis`, 'truck.lights.blinker.right.enabled'),
  B(`${page}.tclock.txt`, 'x.gameClock'),
];

const airWarn = 'truck.brakes.airPressure.warning.enabled || truck.brakes.airPressure.emergency.enabled';
const pct = expr => `min(100, ${expr})`;

export const NEXTION_SEED = {
  id: 'scania',
  name: 'Scania cluster',
  enabled: false,
  port: '',
  baud: 115200,
  width: 480,
  height: 272,
  powerOffWhenIdle: true,
  idlePage: 'page1',
  pages: [
    { name: 'page1', rotation: true, showWhen: '' },
    { name: 'page3', rotation: true, showWhen: '' },
    { name: 'page4', rotation: true, showWhen: '' },
    { name: 'page5', rotation: true, showWhen: '' },
  ],
  hotspots: [
    { x: 50, y: 80, w: 50, h: 14, action: 'next' },
    { x: 0, y: 86, w: 50, h: 14, action: 'prev' },
  ],
  bindings: [
    // page1: main cluster
    B('page1.pblinkl.vis', 'truck.lights.blinker.left.enabled'),
    B('page1.pblinkr.vis', 'truck.lights.blinker.right.enabled'),
    B('page1.plow.vis', 'truck.lights.beamLow.enabled'),
    B('page1.phigh.vis', 'truck.lights.beamHigh.enabled'),
    B('page1.ppark.vis', 'truck.lights.parking.enabled'),
    B('page1.pbeacon.vis', 'truck.lights.beacon.enabled'),
    B('page1.phazard.vis', 'blink(333, truck.lights.hazard.enabled)'),
    B('page1.ptrailer.vis', 'trailer.attached'),
    B('page1.pdiff.vis', 'truck.differential.lock.enabled'),
    B('page1.pparking.vis', 'truck.brakes.parking.enabled'),
    B('page1.pbattery.vis', 'truck.engine.batteryVoltage.warning.enabled'),
    B('page1.pair.vis', airWarn),
    B('page1.pret.vis', 'truck.brakes.retarder.level > 0'),
    B('page1.pcruise.vis', 'truck.cruiseControl.enabled'),
    B('page1.pcruise2.vis', 'truck.cruiseControl.enabled'),
    B('page1.pr1.vis', 'truck.brakes.retarder.level >= 1'),
    B('page1.pr2.vis', 'truck.brakes.retarder.level >= 2'),
    B('page1.pr3.vis', 'truck.brakes.retarder.level >= 3'),
    B('page1.pr4.vis', 'truck.brakes.retarder.level >= 4'),
    B('page1.tclock.txt', 'x.gameClock'),
    B('page1.tfuel.txt', 'truck.fuel.value', 0),
    B('page1.j0.val', 'x.fuelPercent'),
    B('page1.trange.txt', 'truck.fuel.range', 0),
    B('page1.tavg.txt', 'truck.fuel.avgConsumption * 100', 1),
    B('page1.tgear.txt', 'x.gearText'),
    B('page1.tcruise.txt', "truck.cruiseControl.enabled ? round(truck.cruiseControl.kph, 0) : ''", 0),
    B('page1.tret.txt', 'truck.brakes.retarder.level', 0),
    B('page1.tlimit.txt', "navigation.speedLimit.kph > 0 ? navigation.speedLimit.kph : ''", 0),
    B('page1.todo.txt', 'truck.odometer', 1),

    // page3: systems
    ...header('page3'),
    B('page3.tair.txt', 'x.airBar', 1),
    B('page3.jair.val', pct('x.airBar / 13 * 100')),
    B('page3.twat.txt', 'truck.engine.waterTemperature.value', 0),
    B('page3.jwat.val', pct('truck.engine.waterTemperature.value / 120 * 100')),
    B('page3.toil.txt', 'truck.engine.oilTemperature.value', 0),
    B('page3.joil.val', pct('truck.engine.oilTemperature.value / 150 * 100')),
    B('page3.toilp.txt', 'truck.engine.oilPressure.value * x.psiToBar', 1),
    B('page3.joilp.val', pct('truck.engine.oilPressure.value * x.psiToBar / 8 * 100')),
    B('page3.tbrk.txt', 'truck.brakes.temperature.value', 0),
    B('page3.jbrk.val', pct('truck.brakes.temperature.value / 400 * 100')),
    B('page3.tadb.txt', 'x.adBluePercent', 0),
    B('page3.jadb.val', pct('x.adBluePercent')),
    B('page3.wair.vis', airWarn),
    B('page3.wwat.vis', 'truck.engine.waterTemperature.warning.enabled'),
    B('page3.woil.vis', 'truck.engine.oilTemperature.value > 130'),
    B('page3.woilp.vis', 'truck.engine.oilPressure.warning.enabled'),
    B('page3.wbrk.vis', 'truck.brakes.temperature.value > 350'),
    B('page3.wadb.vis', 'truck.adBlue.warning.enabled'),

    // page4: damage
    ...header('page4'),
    ...[['deng', 'engine'], ['dgear', 'transmission'], ['dcab', 'cabin'], ['dchas', 'chassis'], ['dwheel', 'wheels']].flatMap(([n, k]) => [
      B(`page4.t${n}.txt`, `truck.damage.${k} * 100`, 0),
      B(`page4.j${n}.val`, `truck.damage.${k} * 100`),
    ]),
    ...[['rchas', 'trailer.damage.chassis'], ['rwheel', 'trailer.damage.wheels'], ['rbody', 'trailer.body.damage'], ['rcargo', 'trailer.damage.cargo']].flatMap(([n, p]) => [
      B(`page4.t${n}.txt`, `${p} * 100`, 0),
      B(`page4.j${n}.val`, `${p} * 100`),
    ]),
    B('page4.tname.txt', "trailer.attached ? trailer.model.name : 'NO TRAILER'"),
    B('page4.tid.txt', "trailer.attached ? trailer.model.id + ' / ' + trailer.licensePlate.value : ''"),

    // page5: job and route
    ...header('page5'),
    B('page5.tfromc.txt', 'job.source.city.name'),
    B('page5.tfromco.txt', 'job.source.company.name'),
    B('page5.ttoc.txt', 'job.destination.city.name'),
    B('page5.ttoco.txt', 'job.destination.company.name'),
    B('page5.tcargo.txt', 'job.cargo.name'),
    B('page5.tmass.txt', 'job.cargo.mass', 0),
    B('page5.tdist.txt', 'navigation.distance / 1000', 0),
    B('page5.teta.txt', "floor(navigation.time / 3600) + ':' + pad(floor(navigation.time % 3600 / 60), 2)"),
    B('page5.tdue.txt', "floor(x.deliveryMinutes / 60) + ':' + pad(x.deliveryMinutes % 60, 2)"),
    B('page5.tinc.txt', 'job.income', 0),
  ],
};
