// Boards that keep their own settings (the Octopus gauge controller, firmware 0.7+): Studio holds the
// wanted settings per motor socket and uploads them with text commands; the board keeps them in flash.
//   -> "CFG M<n> en=1 dir=0 ms=16 ma=500 hold=30 home=0 spr=200 sweep=2400 full=3000 vmax=500 acc=5000 sg=40"
//   <- "OK CFG M<n>" | "ERR CFG ..."
//   -> "CFG NX en=1 baud=115200"   <- "OK CFG NX"        (the display tunnel on the TFT connector)
//   -> "CFG SAVE"                  <- "OK CFG SAVED"     (flash)
//   -> "CFG?"                      <- "CFG M0 ..." x n, "CFG NX ...", "CFG END motors=6 saved=1"
//   -> "?"                         <- "OCTOPUS-GAUGES 0.8 motors=6 cfg=1"
// Field n of the data line drives MOTORn; the value `full` puts the needle on its last mark.

export const BOARD_TYPES = ['octopus'];
const MICROSTEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

export const MOTOR_DEFAULTS = {
  enabled: true, dir: false, ms: 16, ma: 300, hold: 30, home: false, spr: 200, sweep: 240, full: 10000, vmax: 500, acc: 5000, sg: 40,
};

const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalizeMotor(m = {}) {
  const D = MOTOR_DEFAULTS;
  const sweep = Number(m.sweep);
  return {
    enabled: m.enabled == null ? D.enabled : !!m.enabled,
    dir: !!m.dir,
    ms: MICROSTEPS.includes(Number(m.ms)) ? Number(m.ms) : D.ms,
    ma: int(m.ma, 30, 1500, D.ma),
    hold: int(m.hold, 0, 100, D.hold),
    home: !!m.home,
    spr: int(m.spr, 20, 2000, D.spr),
    sweep: Number.isFinite(sweep) ? Math.min(360, Math.max(10, Math.round(sweep * 10) / 10)) : D.sweep,
    full: int(m.full, 1, 1000000, D.full),
    vmax: int(m.vmax, 1, 3000, D.vmax),
    acc: int(m.acc, 1, 60000, D.acc),
    sg: int(m.sg, 0, 255, D.sg),
  };
}

export function motorCommand(i, m) {
  return `CFG M${i} en=${+m.enabled} dir=${+m.dir} ms=${m.ms} ma=${m.ma} hold=${m.hold} home=${+m.home} spr=${m.spr}` +
    ` sweep=${Math.round(m.sweep * 10)} full=${m.full} vmax=${m.vmax} acc=${m.acc} sg=${m.sg}`;
}

/** "OCTOPUS-GAUGES 0.8 motors=6 cfg=1" -> {type, version, motors, cfg}; null for anything else. */
export function parseHello(text) {
  const m = /^OCTOPUS-GAUGES\s+(\S+)(.*)$/.exec(String(text).trim());
  if (!m) return null;
  const kv = Object.fromEntries([...m[2].matchAll(/(\w+)=(\S+)/g)].map(x => [x[1], x[2]]));
  return { type: 'octopus', version: m[1], motors: Number(kv.motors) || 6, cfg: kv.cfg === '1', power: kv.power === '1' };
}

/** The lines of a "CFG?" answer -> {motors: [...], nx: {en, baud}, saved, count}. */
export function parseCfg(lines) {
  const out = { motors: [], nx: null, saved: false, count: 0 };
  for (const raw of lines) {
    const line = String(raw).trim();
    const kv = Object.fromEntries([...line.matchAll(/(\w+)=(\d+)/g)].map(x => [x[1], Number(x[2])]));
    let m;
    if ((m = /^CFG M(\d+)\s/.exec(line))) {
      out.motors[Number(m[1])] = normalizeMotor({
        enabled: kv.en === 1, dir: kv.dir === 1, ms: kv.ms, ma: kv.ma, hold: kv.hold, home: kv.home === 1,
        spr: kv.spr, sweep: kv.sweep / 10, full: kv.full, vmax: kv.vmax, acc: kv.acc, sg: kv.sg,
      });
    } else if (/^CFG NX\s/.test(line)) out.nx = { en: kv.en === 1, baud: kv.baud };
    else if (/^CFG END/.test(line)) { out.saved = kv.saved === 1; out.count = kv.motors ?? out.motors.length; }
  }
  return out;
}

const SAME_KEYS = Object.keys(MOTOR_DEFAULTS);
/** Socket numbers whose settings differ between two motor lists. */
export function motorDiff(a = [], b = []) {
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!x || !y || SAME_KEYS.some(k => x[k] !== y[k])) diff.push(i);
  }
  return diff;
}
