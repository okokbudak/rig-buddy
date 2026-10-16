'use strict';
// The pin definitions panel of Studio's Board page: what each free pin of the Octopus does (off, output, PWM, input ...),
// with a formula for outputs and live values for inputs. Loaded before app.js; it uses app.js's helpers when its functions run.

const PINSTR = {
  'pins.title': ['Pin tanımları', 'Pin definitions'],
  'pins.lead': [
    'Kartın boştaki pinlerinin ne yaptığını tanımla (Klipper\'ın output_pin / fan ayarları ya da SimHub\'ın pin eşlemesi gibi). Çıkışlar formülü izler; girişler okunur ve formüllerde pin.AD olarak kullanılır. Tanımlar karta yazılır ("Karta yükle"): kapalı pinler hiç sürülmez.',
    'Define what the free pins of the board do (like Klipper\'s output_pin / fan settings or SimHub\'s pin mapping). Outputs follow a formula; inputs are read back and can be used in formulas as pin.NAME. The definitions are written into the board ("Upload to board"): pins that are off are never driven.',
  ],
  'pins.warn24': ['HE0–HE3 ve BED çıkışları 24 V taşır: oraya 12 V\'luk ya da 5 V\'luk bir yük bağlama.', 'HE0–HE3 and BED carry 24 V: do not connect a 12 V or 5 V load there.'],
  'pins.fanNote': ['Fan çıkışlarının gerilimi konnektörün jumper\'ıyla seçilir (5 V / 12 V / VIN); çıkış eksi ucu GND\'ye bağlar. Önce çoklu metreyle ölç.', 'A fan output\'s voltage is set by the header\'s jumper (5 V / 12 V / VIN); the output switches the minus pin to GND. Measure first.'],
  'pins.reserved': [
    'Firmware\'in kendi kullandığı pinler burada yok: motorlar (EN/STEP/DIR/UART/DIAG), FAN0 (Güç çıkışı bölümü), PB0 (LED zinciri), PA9/PA10 (Nextion). FAN6/FAN7\'nin MCU pini yok, hep açıktır.',
    'The pins the firmware uses itself are not here: the motors (EN/STEP/DIR/UART/DIAG), FAN0 (the Power output section), PB0 (the LED chain), PA9/PA10 (the Nextion). FAN6/FAN7 have no MCU pin and are always on.',
  ],
  'pins.group.fan': ['Fan çıkışları', 'Fan outputs'],
  'pins.group.heater': ['Isıtıcı çıkışları (24 V)', 'Heater outputs (24 V)'],
  'pins.group.misc': ['Diğer çıkışlar', 'Other outputs'],
  'pins.group.input': ['Girişler (uç anahtarı, prob, güç algılama)', 'Inputs (stops, probe, power detect)'],
  'pins.group.analog': ['Termistör girişleri (analog, 0–1023)', 'Thermistor inputs (analog, 0–1023)'],
  'pins.mode.off': ['Kapalı', 'Off'],
  'pins.mode.out': ['Çıkış (aç / kapa)', 'Output (on / off)'],
  'pins.mode.pwm': ['PWM çıkış (%)', 'PWM output (%)'],
  'pins.mode.in': ['Giriş', 'Input'],
  'pins.mode.pullup': ['Giriş (pull-up)', 'Input (pull-up)'],
  'pins.mode.adc': ['Analog giriş', 'Analog input'],
  'pins.exprOut': ['Doğruyken açık. Örnek: truck.lights.beamHigh.enabled', 'On while true. Example: truck.lights.beamHigh.enabled'],
  'pins.exprPwm': ['Yüzde 0–100. Örnek: x.rpmPercent', 'Percent 0–100. Example: x.rpmPercent'],
  'pins.inv': ['Ters', 'Inverted'],
  'pins.safe': ['Güvenli seviye: açık', 'Safe level: on'],
  'pins.safeHint': ['Studio 5 sn susarsa çıkış bu seviyeye döner.', 'If Studio is silent for 5 s the output returns to this level.'],
  'pins.test': ['Test (3 sn)', 'Test (3 s)'],
  'pins.label': ['Ad (isteğe bağlı)', 'Name (optional)'],
  'pins.value': ['Şimdi', 'Now'],
  'pins.oldFw': ['Kart firmware\'i pinleri bilmiyor (1.5 gerekli)', 'The board\'s firmware has no pins (needs 1.5)'],
  'pins.usable': ['Formüllerde pin.{name} olarak kullanılır.', 'Use it in formulas as pin.{name}.'],
};
for (const [k, [tr, en]] of Object.entries(PINSTR)) { STRINGS.tr[k] = tr; STRINGS.en[k] = en; }

// [name, mcu pin, capabilities (1 out, 2 pwm, 4 in, 8 adc), group]: the same table as pc/agent/studio/pins.mjs
const UI_PINS = [
  ['FAN1', 'PE5', 3, 'fan'], ['FAN2', 'PD12', 3, 'fan'], ['FAN3', 'PD13', 3, 'fan'], ['FAN4', 'PD14', 3, 'fan'], ['FAN5', 'PD15', 3, 'fan'],
  ['HE0', 'PA2', 3, 'heater'], ['HE1', 'PA3', 3, 'heater'], ['HE2', 'PB10', 3, 'heater'], ['HE3', 'PB11', 3, 'heater'], ['BED', 'PA1', 3, 'heater'],
  ['SERVO', 'PB6', 3, 'misc'], ['PSON', 'PE11', 5, 'misc'],
  ['STOP6', 'PG14', 4, 'input'], ['STOP7', 'PG15', 4, 'input'], ['PROBE', 'PB7', 4, 'input'], ['PWRDET', 'PC0', 4, 'input'],
  ['TB', 'PF3', 12, 'analog'], ['T0', 'PF4', 12, 'analog'], ['T1', 'PF5', 12, 'analog'], ['T2', 'PF6', 12, 'analog'], ['T3', 'PF7', 12, 'analog'],
];
const PIN_OUT = m => m === 'out' || m === 'pwm';
const PIN_IN = m => m === 'in' || m === 'pullup' || m === 'adc';

function pinPanel(d) {
  const rebuild = () => { touch(); renderBoard(); paint(); };
  const modesFor = caps => ['off', ...(caps & 1 ? ['out'] : []), ...(caps & 2 ? ['pwm'] : []), ...(caps & 4 ? ['in', 'pullup'] : []), ...(caps & 8 ? ['adc'] : [])];

  const row = ([name, mcu, caps]) => {
    const e = d.pins.find(x => x.pin === name);
    const mode = e?.mode ?? 'off';
    const sel = select(modesFor(caps).map(m => [m, t(`pins.mode.${m}`)]), mode, v => {
      const at = d.pins.findIndex(x => x.pin === name);
      if (v === 'off') { if (at >= 0) d.pins.splice(at, 1); }
      else if (at >= 0) { d.pins[at].mode = v; if (!PIN_OUT(v)) { d.pins[at].expr = ''; d.pins[at].safe = false; } }
      else d.pins.push({ pin: name, mode: v, expr: '', inv: false, safe: false, label: '' });
      rebuild();
    });
    const parts = [
      el('span', { class: 'pinname' }, el('strong', {}, name), el('span', { class: 'muted small' }, ` ${mcu}`)),
      sel,
    ];
    if (e) {
      parts.push(el('input', { type: 'text', class: 'pinlabel', value: e.label, placeholder: t('pins.label'), maxlength: 24, onchange: ev => { e.label = ev.target.value; touch(); } }));
      if (PIN_OUT(mode)) {
        parts.push(
          el('input', { type: 'text', class: 'mono pinexpr', value: e.expr, list: 'pin-paths', placeholder: t(mode === 'pwm' ? 'pins.exprPwm' : 'pins.exprOut'), onchange: ev => { e.expr = ev.target.value; touch(); } }),
          el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: e.inv, onchange: ev => { e.inv = ev.target.checked; touch(); } }), el('span', {}, t('pins.inv'))),
          el('label', { class: 'switch', title: t('pins.safeHint') }, el('input', { type: 'checkbox', checked: e.safe, onchange: ev => { e.safe = ev.target.checked; touch(); } }), el('span', {}, t('pins.safe'))),
          el('button', { class: 'btn', onclick: () => api('POST', '/api/pin-test', { id: d.id, pin: name, ms: 3000 }).catch(() => {}) }, icon('play'), t('pins.test')),
          el('span', { class: 'small', 'data-role': 'pinval', 'data-pin': name }));
      } else {
        parts.push(
          el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: e.inv, onchange: ev => { e.inv = ev.target.checked; touch(); } }), el('span', {}, t('pins.inv'))),
          el('span', { class: 'small pill off', 'data-role': 'pinval', 'data-pin': name }),
          el('span', { class: 'muted small' }, t('pins.usable', { name })));
      }
    }
    return el('div', { class: `pinrow ${e ? 'on' : ''}` }, ...parts);
  };

  const groups = ['fan', 'heater', 'misc', 'input', 'analog'].map(g => el('div', { class: 'pingroup' },
    el('h4', {}, t(`pins.group.${g}`)),
    ...UI_PINS.filter(p => p[3] === g).map(row)));

  return el('div', { class: 'sockpanel' },
    el('div', { class: 'ehead' }, el('h3', {}, t('pins.title')), el('span', { class: 'pill off', 'data-role': 'pinstate' })),
    el('p', { class: 'muted small' }, t('pins.lead')),
    el('p', { class: 'small err' }, t('pins.warn24')),
    el('p', { class: 'muted small' }, t('pins.fanNote')),
    ...groups,
    el('p', { class: 'muted small' }, t('pins.reserved')),
    el('datalist', { id: 'pin-paths' }, ['truck.engine.enabled', 'truck.electric.enabled', 'truck.lights.beamHigh.enabled', 'truck.lights.beamLow.enabled', 'truck.lights.brake.enabled',
      'truck.lights.blinker.left.active', 'truck.lights.blinker.right.active', 'truck.brakes.parking.enabled', 'truck.speed.kph > 5', 'x.rpmPercent', 'x.fuelPercent', 'pin.STOP6', 'pin.PROBE'].map(p => el('option', { value: p }))));
}

/** Live values of the pins in the card (called from paintBoard). */
function paintPins(card, d, st, board) {
  const state = card.querySelector('[data-role=pinstate]');
  if (state) {
    if (d.pins.length && board && !board.pins) { state.className = 'pill warn'; state.textContent = t('pins.oldFw'); }
    else state.textContent = '';
  }
  const pins = st?.pins ?? { values: {}, out: {}, errors: {} };
  for (const span of card.querySelectorAll('[data-role=pinval]')) {
    const name = span.dataset.pin, e = d.pins.find(x => x.pin === name);
    if (!e) continue;
    if (PIN_OUT(e.mode)) {
      const err = pins.errors?.[name];
      span.textContent = err ? err : pins.out?.[name] != null ? `${t('pins.value')}: ${e.mode === 'pwm' ? `${Math.round(pins.out[name] / 2.55)}%` : pins.out[name] ? 'ON' : 'off'}` : '';
      span.className = `small ${err ? 'err' : 'muted'}`;
    } else {
      const v = pins.values?.[name];
      span.textContent = v == null ? '–' : e.mode === 'adc' ? String(v) : v ? '1' : '0';
      span.className = `small pill ${v ? 'ok' : 'off'}`;
    }
  }
}
