// The free pins of the Octopus Pro (fans, heaters, servo, stops, probe, thermistors): what each one does is defined in Studio's
// Board page and kept in the board (firmware 1.5+, `CFG PIN`). Outputs follow a formula (`PIN <NAME> v=<0..255>`), inputs are
// read back and can be used in formulas as `pin.<NAME>`. The pins the firmware uses itself (motors, FAN0 = the power output,
// PB0 = the LEDs, USART1 = the Nextion) are not here. Same table as PINDEFS in hardware/octopus-fw/gauges/gauges.ino.
export const CAP = { OUT: 1, PWM: 2, IN: 4, ADC: 8 };

// [name, mcu pin, capabilities, group]  groups: fan (12 V / 5 V by jumper), heater (24 V!), misc, input, analog
export const PINS = [
  ['FAN1', 'PE5', 3, 'fan'], ['FAN2', 'PD12', 3, 'fan'], ['FAN3', 'PD13', 3, 'fan'], ['FAN4', 'PD14', 3, 'fan'], ['FAN5', 'PD15', 3, 'fan'],
  ['HE0', 'PA2', 3, 'heater'], ['HE1', 'PA3', 3, 'heater'], ['HE2', 'PB10', 3, 'heater'], ['HE3', 'PB11', 3, 'heater'], ['BED', 'PA1', 3, 'heater'],
  ['SERVO', 'PB6', 3, 'misc'], ['PSON', 'PE11', 5, 'misc'],
  ['STOP6', 'PG14', 4, 'input'], ['STOP7', 'PG15', 4, 'input'], ['PROBE', 'PB7', 4, 'input'], ['PWRDET', 'PC0', 4, 'input'],
  ['TB', 'PF3', 12, 'analog'], ['T0', 'PF4', 12, 'analog'], ['T1', 'PF5', 12, 'analog'], ['T2', 'PF6', 12, 'analog'], ['T3', 'PF7', 12, 'analog'],
].map(([name, mcu, caps, group]) => ({ name, mcu, caps, group }));

export const MODES = ['off', 'out', 'pwm', 'in', 'pullup', 'adc']; // the index is the firmware's mode number
const NEEDS = { out: CAP.OUT, pwm: CAP.PWM, in: CAP.IN, pullup: CAP.IN, adc: CAP.ADC };
export const modeAllowed = (pin, mode) => mode === 'off' || (pin.caps & (NEEDS[mode] ?? 0)) !== 0;
export const isOutputMode = m => m === 'out' || m === 'pwm';
export const isInputMode = m => m === 'in' || m === 'pullup' || m === 'adc';

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The defined pins only (a pin that is off is simply not in the list). Unknown pins, modes the pin cannot do and duplicates are dropped. */
export function normalizePins(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const name = String(e?.pin ?? '').toUpperCase();
    const pin = PINS.find(p => p.name === name);
    const mode = MODES.includes(e?.mode) ? e.mode : 'off';
    if (!pin || seen.has(name) || mode === 'off' || !modeAllowed(pin, mode)) continue;
    seen.add(name);
    out.push({
      pin: name,
      mode,
      expr: isOutputMode(mode) ? str(e.expr, 300) : '',
      inv: !!e.inv,
      safe: isOutputMode(mode) && !!e.safe, // the level an output falls back to when Studio goes silent
      label: str(e.label, 24),
    });
  }
  return out.slice(0, PINS.length);
}

/** `CFG PIN <NAME> mode=<n> inv=<0|1> safe=<0|1>` for a defined pin, or for an undefined one (back to off). */
export function pinConfigCommand(name, e) {
  return `CFG PIN ${name} mode=${e ? MODES.indexOf(e.mode) : 0} inv=${e ? +e.inv : 0} safe=${e ? +e.safe : 0}`;
}

/** A value for an output: `out` = on/off from truthiness, `pwm` = a percentage (0..100) as 0..255. */
export function pinOutputValue(mode, v) {
  if (typeof v === 'string') v = v.length > 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (mode === 'pwm') return Math.round(Math.min(100, Math.max(0, n)) * 255 / 100);
  return n !== 0 ? 1 : 0;
}
