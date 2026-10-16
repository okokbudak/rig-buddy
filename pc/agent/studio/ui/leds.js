'use strict';
// Studio's LED tab: split the LED chain into segments, give them effects (WLED-style), game-linked bars and rules
// (SimHub-style), correct the colours, keep presets. The strip follows every change while you drag (POST /api/led-live)
// and the preview shows the frames the PC really sends (socket message {leds}). Loaded before app.js; it uses app.js's
// helpers (el, field, select, touch, api, t, state ...) only when its functions run.

const LEDSTR = {
  'tab.leds': ['LED', 'LEDs'],
  'leds.title': ['LED şeritler', 'LED strips'],
  'leds.lead': 'Zinciri parçalara böl, her parçaya efekt, renk ya da oyun verisi bağla. Sürüklerken şeritler anında değişir. Kart sayfasındaki "Karta yükle" şeridin kartta saklanan kopyasını da yazar (PC yokken yanar).',
  'leds.leadEn': 'Split the chain into segments and give each an effect, a colour or a game value. The strips follow while you drag. "Upload to board" on the Board page also writes the strip\'s stored copy into the board (it lights without the PC).',
  'leds.empty': ['Henüz kart yok', 'No board yet'],
  'leds.emptyLead': ['LED zincirini süren kartı Bağlantılar sayfasından ekle.', 'Add the board that drives the LED chain on the Connections page.'],
  'leds.use': ['LED\'leri Studio sürsün', 'Studio drives the LEDs'],
  'leds.useHint': ['Kapalıyken şerit kartta saklı ayarlarla yanar.', 'While off, the strip shows the settings stored on the board.'],
  'leds.sleep': ['Oyun yokken söndür', 'Dark without a game'],
  'leds.sleepHint': ['Oyun kapalıyken ve test etmiyorsan LED\'ler yanmaz. Düzenlerken ya da "Test" ile görürsün.', 'No game and no test: the LEDs stay dark. You still see them while editing or with "Test".'],
  'leds.test': ['Test (60 sn yak)', 'Test (light for 60 s)'],
  'leds.testEnd': ['Testi bitir', 'End test'],
  'leds.awake': ['Yanıyor', 'Lit'],
  'leds.dark': ['Sönük (oyun yok)', 'Dark (no game)'],
  'leds.preview': ['Önizleme: PC\'nin gerçekten gönderdiği kare', 'Preview: the frame the PC really sends'],
  'leds.general': ['Genel ve renk düzeltme', 'General and colour correction'],
  'leds.count': ['Zincirdeki IC sayısı', 'ICs in the chain'],
  'leds.countHint': ['Bütün şeritler toplamı (3 LED = 1 IC).', 'All strips together (3 LEDs = 1 IC).'],
  'leds.order': ['Renk sırası', 'Colour order'],
  'leds.orderHint': ['Kırmızı yerine başka renk yanıyorsa değiştir. Bu şeritler: BRG.', 'Change it if red lights up as another colour. These strips: BRG.'],
  'leds.bri': ['Parlaklık', 'Brightness'],
  'leds.maxBri': ['Parlaklık sınırı', 'Brightness cap'],
  'leds.maxBriHint': ['Güç kaynağını ve şeritleri korumak için üst sınır.', 'An upper limit to protect the supply and the strips.'],
  'leds.gamma': ['Gama düzeltmesi', 'Gamma correction'],
  'leds.gammaHint': ['1,0 kapalı. Orta tonlar çok parlak görünüyorsa 2,2 dene (WLED varsayılanı 2,8).', '1.0 is off. If mid tones look too bright try 2.2 (WLED default 2.8).'],
  'leds.temp': ['Beyaz dengesi', 'White balance'],
  'leds.tempHint': ['+ daha sıcak (sarı), − daha soğuk (mavi).', '+ warmer (yellow), − cooler (blue).'],
  'leds.sat': ['Doygunluk', 'Saturation'],
  'leds.rgb': ['Kanal ayarı (kırmızı / yeşil / mavi)', 'Channel scale (red / green / blue)'],
  'leds.rgbHint': ['Şeridin beyazı bir renge kayıyorsa o kanalı kıs.', 'If the strip\'s white leans to a colour, turn that channel down.'],
  'leds.smooth': ['Yumuşak geçiş (ms)', 'Smooth fade (ms)'],
  'leds.smoothHint': ['Renk değişimleri bu sürede birbirine geçer. Hızlı efektleri bulanıklaştırır; 0 kapalı.', 'Colour changes cross-fade over this time. It blurs fast effects; 0 is off.'],
  'leds.segments': ['Parçalar', 'Segments'],
  'leds.segmentsHint': ['Sonraki parça öncekinin üstüne boyar. Parçada olmayan IC\'ler sönük kalır.', 'A later segment paints over an earlier one. ICs in no segment stay dark.'],
  'leds.segment': ['Parça {n}', 'Segment {n}'],
  'leds.start': ['Başlangıç', 'Start'],
  'leds.len': ['Uzunluk', 'Length'],
  'leds.on': ['Açık', 'On'],
  'leds.add': ['Parça ekle', 'Add segment'],
  'leds.split': ['Böl', 'Split'],
  'leds.dup': ['Kopyala', 'Duplicate'],
  'leds.remove': ['Sil', 'Delete'],
  'leds.up': ['Yukarı', 'Up'],
  'leds.down': ['Aşağı', 'Down'],
  'leds.preset6': ['6 şerit (6+6+3+3+3+3)', '6 strips (6+6+3+3+3+3)'],
  'leds.allOff': ['Hepsini kapat', 'All off'],
  'leds.mode': ['Tür', 'Type'],
  'leds.modeEffect': ['Efekt', 'Effect'],
  'leds.modeBar': ['Oyun çubuğu', 'Game bar'],
  'leds.reverse': ['Ters çevir', 'Reverse'],
  'leds.mirror': ['Aynala', 'Mirror'],
  'leds.group': ['Gruplama', 'Grouping'],
  'leds.groupHint': ['Her N IC aynı renkte.', 'Every N ICs share a colour.'],
  'leds.spacing': ['Boşluk', 'Spacing'],
  'leds.spacingHint': ['Gruplar arasında N sönük IC.', 'N dark ICs between the groups.'],
  'leds.segBri': ['Parça parlaklığı', 'Segment brightness'],
  'leds.opacity': ['Saydamlık (altındakiyle karışım)', 'Opacity (blend with what is below)'],
  'leds.effect': ['Efekt', 'Effect'],
  'leds.palette': ['Palet', 'Palette'],
  'leds.speed': ['Hız', 'Speed'],
  'leds.intensity': ['Yoğunluk', 'Intensity'],
  'leds.color1': ['Renk 1', 'Colour 1'],
  'leds.color2': ['Renk 2 (zemin)', 'Colour 2 (background)'],
  'leds.color3': ['Renk 3', 'Colour 3'],
  'leds.bar': ['Oyun çubuğu', 'Game bar'],
  'leds.barValue': ['Değer (formül)', 'Value (formula)'],
  'leds.barValueHint': ['Örnek: x.rpmPercent, abs(truck.speed.kph), x.fuelPercent', 'Examples: x.rpmPercent, abs(truck.speed.kph), x.fuelPercent'],
  'leds.barLo': ['En düşük değer', 'Lowest value'],
  'leds.barHi': ['En yüksek değer', 'Highest value'],
  'leds.barDir': ['Dolma yönü', 'Fill direction'],
  'leds.dirUp': ['Baştan sona', 'Start to end'],
  'leds.dirCenter': ['Ortadan dışarı', 'Centre outwards'],
  'leds.dirEdges': ['Kenarlardan içeri', 'Edges inwards'],
  'leds.barBg': ['Sönük renk', 'Unlit colour'],
  'leds.barPeak': ['Tepe noktasını tut', 'Hold the peak'],
  'leds.barBlink': ['Şu orandan sonra yanıp sön (%)', 'Flash from (%)'],
  'leds.barBlinkHint': ['0 = hiç. Örnek: devir çubuğu için 92.', '0 = never. Example: 92 for an rpm bar.'],
  'leds.stops': ['Renk geçişi', 'Colour gradient'],
  'leds.stopsHint': ['Çubuk boyunca renkler (konum %).', 'Colours along the bar (position %).'],
  'leds.stopAdd': ['Renk ekle', 'Add colour'],
  'leds.rules': ['Kurallar', 'Rules'],
  'leds.rulesHint': ['Sırayla bakılır; formülü doğru olan ilk kural parçanın görünümünü değiştirir.', 'Checked in order; the first rule whose formula is true replaces the segment\'s look.'],
  'leds.rule': ['Kural {n}', 'Rule {n}'],
  'leds.ruleWhen': ['Şu doğruyken (formül)', 'When this is true (formula)'],
  'leds.ruleAdd': ['Kural ekle', 'Add rule'],
  'leds.templates': ['Hazır şablonlar', 'Ready-made templates'],
  'leds.templatesHint': ['Oyun verisine bağlı hazır parçalar eklenir; sonra başlangıç ve uzunluğu ayarla.', 'Adds ready-made game-linked segments; set their start and length afterwards.'],
  'leds.presets': ['Hazır ayarlar ve oynatma listesi', 'Presets and playlist'],
  'leds.presetName': ['Ad', 'Name'],
  'leds.presetSave': ['Şimdikini kaydet', 'Save the current one'],
  'leds.presetLoad': ['Yükle', 'Load'],
  'leds.presetNone': ['Henüz kayıtlı ayar yok.', 'No presets yet.'],
  'leds.playlist': ['Oynatma listesi', 'Playlist'],
  'leds.playlistHint': ['Açıkken kayıtlı ayarlar sırayla, belirtilen sürelerle gösterilir.', 'While on, the presets show in turn for the given times.'],
  'leds.playlistAdd': ['Ayar ekle', 'Add preset'],
  'leds.sec': ['sn', 's'],
  'leds.errors': ['Formül hatası', 'Formula error'],
  'leds.loading': ['Yükleniyor…', 'Loading…'],
  'tpl.rpm': ['Devir çubuğu', 'RPM bar'],
  'tpl.speed': ['Hız çubuğu', 'Speed bar'],
  'tpl.fuel': ['Yakıt göstergesi', 'Fuel gauge'],
  'tpl.left': ['Sol sinyal', 'Left indicator'],
  'tpl.right': ['Sağ sinyal', 'Right indicator'],
  'tpl.hazard': ['Dörtlü flaşör', 'Hazard lights'],
  'tpl.brake': ['Fren lambası', 'Brake light'],
  'tpl.reverse': ['Geri vites', 'Reverse light'],
  'tpl.beam': ['Uzun far uyarısı', 'High beam'],
  'tpl.park': ['El freni', 'Parking brake'],
  'tpl.warn': ['Genel uyarı (yağ, su, hava)', 'General warning (oil, water, air)'],
  'tpl.ignition': ['Kontak açık ambiyans', 'Ignition ambience'],
  'tpl.beacon': ['Çakar', 'Beacon'],
};
for (const [k, v] of Object.entries(LEDSTR)) {
  if (Array.isArray(v)) { STRINGS.tr[k] = v[0]; STRINGS.en[k] = v[1]; }
}
STRINGS.tr['leds.lead'] = LEDSTR['leds.lead'];
STRINGS.en['leds.lead'] = LEDSTR['leds.leadEn'];
for (const [id, tr, en] of [
  ['colors', 'Seçtiğim renkler', 'My colours'], ['rainbow', 'Gökkuşağı', 'Rainbow'], ['fire', 'Ateş', 'Fire'], ['ocean', 'Okyanus', 'Ocean'],
  ['forest', 'Orman', 'Forest'], ['lava', 'Lav', 'Lava'], ['party', 'Parti', 'Party'], ['sunset', 'Gün batımı', 'Sunset'],
  ['ice', 'Buz', 'Ice'], ['cyber', 'Siber', 'Cyber'], ['heat', 'Isı', 'Heat'],
]) { STRINGS.tr[`pal.${id}`] = tr; STRINGS.en[`pal.${id}`] = en; }

const LED_ORDER_NAMES = ['RGB', 'GRB', 'BRG', 'RBG', 'GBR', 'BGR'];
const LED_PATHS = [
  'truck.lights.blinker.left.active', 'truck.lights.blinker.right.active', 'truck.lights.hazard.enabled', 'truck.lights.brake.enabled',
  'truck.lights.reverse.enabled', 'truck.lights.beamLow.enabled', 'truck.lights.beamHigh.enabled', 'truck.lights.parking.enabled',
  'truck.lights.beacon.enabled', 'truck.brakes.parking.enabled', 'truck.electric.enabled', 'truck.engine.enabled',
  'truck.fuel.warning.enabled', 'truck.adBlue.warning.enabled', 'truck.engine.oilPressure.warning.enabled',
  'truck.engine.waterTemperature.warning.enabled', 'truck.engine.batteryVoltage.warning.enabled',
  'truck.brakes.airPressure.warning.enabled', 'truck.brakes.airPressure.emergency.enabled', 'truck.cruiseControl.enabled',
  'truck.speed.kph', 'abs(truck.speed.kph)', 'truck.engine.rpm.value', 'x.rpmPercent', 'x.fuelPercent', 'x.adBluePercent', 'x.airBar',
  'truck.engine.waterTemperature.value', 'truck.engine.oilTemperature.value', 'controls.game.throttle', 'controls.game.brake',
];

const LED = { catalog: null, loading: false, open: {}, sel: {} }; // per-board UI state: which segment is open
const ledPick = (a, b) => (LANG === 'tr' ? a : b);

async function ledLoadCatalog() {
  if (LED.catalog || LED.loading) return;
  LED.loading = true;
  try { LED.catalog = await api('GET', '/api/led-catalog'); } catch { LED.loading = false; return; }
  if (state.tab === 'leds') renderLeds();
}

// --- templates (SimHub-style: ready-made game-linked segments) --------------------------------------------

const LED_WARM = '#ff9329';
const ledLook = (fx, extra = {}) => ({ fx, pal: 'colors', speed: 128, intensity: 128, c1: LED_WARM, c2: '#000000', c3: '#000000', ...extra });
const TEMPLATES = {
  rpm: () => ({ mode: 'bar', bar: { value: 'x.rpmPercent', lo: 0, hi: 100, stops: [[0, '#00c000'], [0.7, '#ffd000'], [0.9, '#ff2000']], bg: '#050505', dir: 'up', peak: true, blinkAbove: 94 } }),
  speed: () => ({ mode: 'bar', bar: { value: 'abs(truck.speed.kph)', lo: 0, hi: 130, stops: [[0, '#2f6fde'], [0.7, '#2fd0ff'], [1, '#ffffff']], bg: '#050505', dir: 'up', peak: false, blinkAbove: 0 } }),
  fuel: () => ({ mode: 'bar', bar: { value: 'x.fuelPercent', lo: 0, hi: 100, stops: [[0, '#ff2000'], [0.25, '#ffd000'], [0.5, '#00c000']], bg: '#050505', dir: 'up', peak: false, blinkAbove: 0 },
    rules: [{ name: 'low', when: 'truck.fuel.warning.enabled', look: ledLook('blink', { c1: '#ff2000', speed: 150 }) }] }),
  left: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), reverse: true, rules: [{ name: 'left', when: 'truck.lights.blinker.left.active', look: ledLook('wipe', { c1: '#ff8000', c2: '#000000', speed: 200 }) }] }),
  right: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'right', when: 'truck.lights.blinker.right.active', look: ledLook('wipe', { c1: '#ff8000', c2: '#000000', speed: 200 }) }] }),
  hazard: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'hazard', when: 'truck.lights.hazard.enabled', look: ledLook('blink', { c1: '#ff8000', c2: '#000000', speed: 170 }) }] }),
  brake: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#200000' }), rules: [{ name: 'brake', when: 'truck.lights.brake.enabled', look: ledLook('solid', { c1: '#ff0000' }) }] }),
  reverse: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'reverse', when: 'truck.lights.reverse.enabled', look: ledLook('solid', { c1: '#ffffff' }) }] }),
  beam: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'high beam', when: 'truck.lights.beamHigh.enabled', look: ledLook('solid', { c1: '#2f6fde' }) }] }),
  park: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'parking brake', when: 'truck.brakes.parking.enabled', look: ledLook('breathe', { c1: '#ff2000', c2: '#100000', speed: 120 }) }] }),
  warn: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }),
    rules: [{ name: 'warning', when: 'truck.engine.oilPressure.warning.enabled || truck.engine.waterTemperature.warning.enabled || truck.brakes.airPressure.emergency.enabled || truck.engine.batteryVoltage.warning.enabled',
      look: ledLook('strobe', { c1: '#ff0000', c2: '#000000', speed: 90, intensity: 128 }) }] }),
  ignition: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'ignition', when: 'truck.electric.enabled', look: ledLook('palette', { pal: 'sunset', speed: 40 }) }] }),
  beacon: () => ({ mode: 'effect', look: ledLook('solid', { c1: '#000000' }), rules: [{ name: 'beacon', when: 'truck.lights.beacon.enabled', look: ledLook('police', { c1: '#ff8000', c2: '#ff8000', speed: 200 }) }] }),
};

// --- the tab ---------------------------------------------------------------------------------------------

function renderLeds() {
  const page = $('#page-leds');
  const boards = state.config.serial.filter(d => d.board);
  const kids = [header(t('leds.title'), t('leds.lead'))];
  if (!boards.length) {
    kids.push(emptyState('bulb', t('leds.empty'), t('leds.emptyLead'), el('button', { class: 'btn primary', onclick: () => showTab('connections') }, t('cockpit.gotoConnections'))));
  } else if (!LED.catalog) {
    kids.push(el('p', { class: 'muted' }, t('leds.loading')));
    ledLoadCatalog();
  } else for (const d of boards) kids.push(ledCard(d));
  page.replaceChildren(...kids);
  paintLeds();
}

const ledTimers = {};
function ledLive(d) { // the whole chain goes to the strip while a control moves (at most ~12 times a second)
  if (ledTimers[d.id]) return;
  ledTimers[d.id] = setTimeout(() => { delete ledTimers[d.id]; api('POST', '/api/led-live', { id: d.id, leds: d.leds }).catch(() => {}); }, 80);
}

const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || lo));

function ledCard(d) {
  const L = d.leds;
  const rebuild = () => { touch(); ledLive(d); renderLeds(); };
  const done = () => { touch(); ledLive(d); };

  // small control factories bound to this board
  const slider = (label, obj, key, min, max, { step = 1, fmt = v => String(v), hint } = {}) => {
    const out = el('span', { class: 'small' }, fmt(obj[key]));
    const inp = el('input', { type: 'range', min, max, step, value: obj[key],
      oninput: e => { obj[key] = Number(e.target.value); out.textContent = fmt(obj[key]); ledLive(d); },
      onchange: () => touch() });
    return field(label, el('span', { class: 'row' }, inp, out), hint);
  };
  const colorIn = (obj, key, title) => el('input', { type: 'color', value: obj[key], title,
    oninput: e => { obj[key] = e.target.value; ledLive(d); }, onchange: e => { obj[key] = e.target.value; done(); ledMarkSwatches(d); } });
  const checkbox = (label, obj, key, after) => el('label', { class: 'switch' },
    el('input', { type: 'checkbox', checked: !!obj[key], onchange: e => { obj[key] = e.target.checked; after ? after() : done(); } }), el('span', {}, label));
  const numIn = (obj, key, min, max, after) => el('input', { type: 'number', class: 'n', min, max, value: obj[key],
    onchange: e => { obj[key] = clampN(e.target.value, min, max); after ? after() : done(); } });

  // --- look editor (effect + palette + sliders + colours): for a segment and for every rule ---
  const lookEditor = lk => {
    const meta = LED.catalog.effects.find(e => e.id === lk.fx) ?? LED.catalog.effects[0];
    const parts = [
      field(t('leds.effect'), select(LED.catalog.effects.map(e => [e.id, ledPick(e.tr, e.en)]), lk.fx, v => { lk.fx = v; rebuild(); })),
      meta.pal ? field(t('leds.palette'), select(LED.catalog.palettes.map(p => [p, t(`pal.${p}`)]), lk.pal, v => { lk.pal = v; rebuild(); })) : null,
      meta.sp ? slider(t('leds.speed'), lk, 'speed', 0, 255) : null,
      meta.it ? slider(t('leds.intensity'), lk, 'intensity', 0, 255) : null,
    ];
    const showColors = meta.col > 0 && (!meta.pal || lk.pal === 'colors');
    if (showColors) {
      const cs = [['c1', 'leds.color1'], ['c2', 'leds.color2'], ['c3', 'leds.color3']].slice(0, meta.col);
      parts.push(el('div', { class: 'field' }, el('span', { class: 'flabel' }, ledPick('Renkler', 'Colours')),
        el('span', { class: 'row' }, ...cs.map(([k, key]) => colorIn(lk, k, t(key))))));
    }
    return el('div', { class: 'fields' }, parts);
  };

  // --- bar editor ---
  const barEditor = bar => el('div', { class: 'fields' },
    field(t('leds.barValue'), el('input', { type: 'text', class: 'mono', value: bar.value, list: 'led-paths', onchange: e => { bar.value = e.target.value; done(); } }), t('leds.barValueHint')),
    field(t('leds.barLo'), el('input', { type: 'number', class: 'n', value: bar.lo, onchange: e => { bar.lo = Number(e.target.value); done(); } })),
    field(t('leds.barHi'), el('input', { type: 'number', class: 'n', value: bar.hi, onchange: e => { bar.hi = Number(e.target.value); done(); } })),
    field(t('leds.barDir'), select([['up', t('leds.dirUp')], ['center', t('leds.dirCenter')], ['edges', t('leds.dirEdges')]], bar.dir, v => { bar.dir = v; rebuild(); })),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, t('leds.barBg')), colorIn(bar, 'bg', t('leds.barBg'))),
    checkbox(t('leds.barPeak'), bar, 'peak'),
    field(t('leds.barBlink'), numIn(bar, 'blinkAbove', 0, 100), t('leds.barBlinkHint')),
    el('div', { class: 'field wide' }, el('span', { class: 'flabel' }, t('leds.stops')),
      ...bar.stops.map((s, i) => el('div', { class: 'row stoprow' },
        el('input', { type: 'number', class: 'n', min: 0, max: 100, value: Math.round(s[0] * 100), title: '%', onchange: e => { s[0] = clampN(e.target.value, 0, 100) / 100; bar.stops.sort((a, z) => a[0] - z[0]); rebuild(); } }),
        el('span', { class: 'small muted' }, '%'),
        el('input', { type: 'color', value: s[1], oninput: e => { s[1] = e.target.value; ledLive(d); }, onchange: e => { s[1] = e.target.value; done(); } }),
        el('button', { class: 'btn', disabled: bar.stops.length < 2, onclick: () => { bar.stops.splice(i, 1); rebuild(); } }, icon('trash')))),
      el('button', { class: 'btn', disabled: bar.stops.length >= 6, onclick: () => { bar.stops.push([1, '#ffffff']); bar.stops.sort((a, z) => a[0] - z[0]); rebuild(); } }, icon('plus'), t('leds.stopAdd')),
      el('span', { class: 'fhint' }, t('leds.stopsHint'))));

  // --- one segment ---
  const segCard = (seg, i) => {
    const open = LED.open[d.id] === i;
    const swatch = el('span', { class: 'segswatch', 'data-seg': i });
    swatch.style.background = seg.mode === 'bar' ? seg.bar.stops[0][1] : seg.look.c1;
    const head = el('div', { class: 'seghead', onclick: e => { if (e.target.closest('input,button,label,select')) return; LED.open[d.id] = open ? null : i; renderLeds(); } },
      swatch,
      el('input', { type: 'text', class: 'ledname', value: seg.name, placeholder: t('leds.segment', { n: i + 1 }), maxlength: 24, onchange: e => { seg.name = e.target.value; touch(); } }),
      el('label', { class: 'ledn' }, t('leds.start'), numIn(seg, 'start', 0, L.count - 1, () => { seg.len = clampN(seg.len, 1, L.count - seg.start); rebuild(); })),
      el('label', { class: 'ledn' }, t('leds.len'), numIn(seg, 'len', 1, L.count, () => { seg.len = clampN(seg.len, 1, L.count - seg.start); rebuild(); })),
      checkbox(t('leds.on'), seg, 'on'),
      el('button', { class: 'btn', title: t('leds.up'), disabled: i === 0, onclick: () => { [L.segments[i - 1], L.segments[i]] = [L.segments[i], L.segments[i - 1]]; LED.open[d.id] = i - 1; rebuild(); } }, '↑'),
      el('button', { class: 'btn', title: t('leds.down'), disabled: i === L.segments.length - 1, onclick: () => { [L.segments[i + 1], L.segments[i]] = [L.segments[i], L.segments[i + 1]]; LED.open[d.id] = i + 1; rebuild(); } }, '↓'),
      el('button', { class: 'btn', title: t('leds.split'), disabled: seg.len < 2, onclick: () => {
        const half = Math.floor(seg.len / 2), copy = structuredClone(seg);
        copy.start = seg.start + seg.len - half; copy.len = half; copy.name = '';
        seg.len -= half; L.segments.splice(i + 1, 0, copy); rebuild();
      } }, icon('split')),
      el('button', { class: 'btn', title: t('leds.dup'), disabled: L.segments.length >= 16, onclick: () => { L.segments.splice(i + 1, 0, structuredClone(seg)); LED.open[d.id] = i + 1; rebuild(); } }, icon('copy')),
      el('button', { class: 'btn', title: t('leds.remove'), onclick: () => { L.segments.splice(i, 1); LED.open[d.id] = null; rebuild(); } }, icon('trash')));
    if (!open) return el('div', { class: 'segcard' }, head);
    const rules = el('div', { class: 'rules' },
      el('h4', {}, t('leds.rules')), el('p', { class: 'muted small' }, t('leds.rulesHint')),
      ...seg.rules.map((r, k) => el('div', { class: 'rule' },
        el('div', { class: 'row' },
          el('input', { type: 'text', class: 'ledname', value: r.name, placeholder: t('leds.rule', { n: k + 1 }), maxlength: 24, onchange: e => { r.name = e.target.value; touch(); } }),
          el('button', { class: 'btn', onclick: () => { seg.rules.splice(k, 1); rebuild(); } }, icon('trash'))),
        field(t('leds.ruleWhen'), el('input', { type: 'text', class: 'mono', value: r.when, list: 'led-paths', onchange: e => { r.when = e.target.value; done(); } })),
        lookEditor(r.look))),
      el('button', { class: 'btn', disabled: seg.rules.length >= 8, onclick: () => { seg.rules.push({ name: '', when: 'truck.engine.enabled', look: { fx: 'solid', pal: 'colors', speed: 128, intensity: 128, c1: '#ff0000', c2: '#000000', c3: '#000000' } }); rebuild(); } }, icon('plus'), t('leds.ruleAdd')));
    const body = el('div', { class: 'segbody' },
      el('div', { class: 'fields' },
        field(t('leds.mode'), select([['effect', t('leds.modeEffect')], ['bar', t('leds.modeBar')]], seg.mode, v => { seg.mode = v; rebuild(); })),
        checkbox(t('leds.reverse'), seg, 'reverse'),
        checkbox(t('leds.mirror'), seg, 'mirror'),
        field(t('leds.group'), numIn(seg, 'group', 1, 16), t('leds.groupHint')),
        field(t('leds.spacing'), numIn(seg, 'spacing', 0, 16), t('leds.spacingHint')),
        slider(t('leds.segBri'), seg, 'bri', 0, 255),
        slider(t('leds.opacity'), seg, 'opacity', 0, 100)),
      seg.mode === 'bar' ? barEditor(seg.bar) : lookEditor(seg.look),
      rules);
    return el('div', { class: 'segcard open' }, head, body);
  };

  // --- the preview strip ---
  const strip = el('div', { class: 'ledstrip', 'data-dev': d.id }, ...Array.from({ length: L.count }, (_, i) => el('span', { class: 'ledcell dark', title: String(i) })));
  ledMarkCells(d, strip);

  const stateLine = el('span', { class: 'muted small', 'data-role': 'ledstate', 'data-dev': d.id });
  const errs = el('div', { class: 'err small', 'data-role': 'lederr', 'data-dev': d.id });

  const general = el('details', { class: 'adv', open: true },
    el('summary', {}, t('leds.general')),
    el('div', { class: 'fields' },
      slider(t('leds.bri'), L, 'bri', 0, 255),
      slider(t('leds.maxBri'), L, 'maxBri', 10, 255, { hint: t('leds.maxBriHint') }),
      field(t('leds.count'), numIn(L, 'count', 1, 64, () => { L.segments = L.segments.filter(s => s.start < L.count); for (const s of L.segments) s.len = clampN(s.len, 1, L.count - s.start); rebuild(); }), t('leds.countHint')),
      field(t('leds.order'), select(LED_ORDER_NAMES.map((o, i) => [String(i), o]), String(L.order), v => { L.order = Number(v); done(); }), t('leds.orderHint')),
      slider(t('leds.gamma'), L, 'gamma', 1, 3, { step: 0.1, fmt: v => Number(v).toFixed(1), hint: t('leds.gammaHint') }),
      slider(t('leds.temp'), L, 'temp', -100, 100, { fmt: v => (v > 0 ? `+${v}` : String(v)), hint: t('leds.tempHint') }),
      slider(t('leds.sat'), L, 'sat', 0, 200, { fmt: v => `${v}%` }),
      el('div', { class: 'field wide' }, el('span', { class: 'flabel' }, t('leds.rgb')),
        ...[['#ff6a5e', 0], ['#5edb7a', 1], ['#6aa7ff', 2]].map(([c, i]) => {
          const out = el('span', { class: 'small' }, `${L.rgb[i]}%`);
          return el('span', { class: 'row' }, el('span', { class: 'chdot', style: `background:${c}` }),
            el('input', { type: 'range', min: 0, max: 100, value: L.rgb[i], oninput: e => { L.rgb[i] = Number(e.target.value); out.textContent = `${L.rgb[i]}%`; ledLive(d); }, onchange: () => touch() }), out);
        }), el('span', { class: 'fhint' }, t('leds.rgbHint'))),
      slider(t('leds.smooth'), L, 'smooth', 0, 1000, { step: 10, hint: t('leds.smoothHint') })));

  const segs = el('details', { class: 'adv', open: true },
    el('summary', {}, t('leds.segments')),
    el('p', { class: 'muted small' }, t('leds.segmentsHint')),
    el('div', { class: 'segs' }, L.segments.map(segCard)),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', disabled: L.segments.length >= 16, onclick: () => {
        const end = L.segments.reduce((m, s) => Math.max(m, s.start + s.len), 0), at = end < L.count ? end : 0;
        L.segments.push({ name: '', start: at, len: Math.max(1, Math.min(3, L.count - at)), on: true, bri: 255, opacity: 100, reverse: false, mirror: false, group: 1, spacing: 0, mode: 'effect', look: ledLook('solid'), bar: TEMPLATES.rpm().bar, rules: [] });
        LED.open[d.id] = L.segments.length - 1; rebuild();
      } }, icon('plus'), t('leds.add')),
      el('button', { class: 'btn', onclick: () => {
        let at = 0;
        L.count = 24;
        L.segments = [6, 6, 3, 3, 3, 3].map(len => ({ name: '', start: (at += len) - len, len, on: true, bri: 255, opacity: 100, reverse: false, mirror: false, group: 1, spacing: 0, mode: 'effect', look: ledLook('solid'), bar: TEMPLATES.rpm().bar, rules: [] }));
        LED.open[d.id] = null; rebuild();
      } }, icon('refresh'), t('leds.preset6')),
      el('button', { class: 'btn', onclick: () => { L.segments.forEach(s => { s.on = false; }); rebuild(); } }, t('leds.allOff'))));

  const tplSel = el('select', {}, Object.keys(TEMPLATES).map(k => el('option', { value: k }, t(`tpl.${k}`))));
  const templates = el('details', { class: 'adv' },
    el('summary', {}, t('leds.templates')),
    el('p', { class: 'muted small' }, t('leds.templatesHint')),
    el('div', { class: 'actions' }, tplSel, el('button', { class: 'btn', disabled: L.segments.length >= 16, onclick: () => {
      const end = L.segments.reduce((m, s) => Math.max(m, s.start + s.len), 0), at = end < L.count ? end : 0;
      const seg = { name: t(`tpl.${tplSel.value}`), start: at, len: Math.max(1, Math.min(6, L.count - at)), on: true, bri: 255, opacity: 100, reverse: false, mirror: false, group: 1, spacing: 0, mode: 'effect', look: ledLook('solid'), bar: TEMPLATES.rpm().bar, rules: [], ...TEMPLATES[tplSel.value]() };
      L.segments.push(seg); LED.open[d.id] = L.segments.length - 1; rebuild();
    } }, icon('plus'), t('leds.add'))));

  // presets and playlist
  const nameIn = el('input', { type: 'text', class: 'ledname', placeholder: t('leds.presetName'), maxlength: 24 });
  const presets = el('details', { class: 'adv' },
    el('summary', {}, t('leds.presets')),
    L.presets.length ? el('div', { class: 'presets' }, L.presets.map((p, i) => el('div', { class: 'row' },
      el('strong', {}, p.name),
      el('button', { class: 'btn', onclick: () => { L.segments = structuredClone(p.segments); L.active = p.name; LED.open[d.id] = null; rebuild(); } }, t('leds.presetLoad')),
      el('button', { class: 'btn', onclick: () => { L.presets.splice(i, 1); rebuild(); } }, icon('trash')))))
      : el('p', { class: 'muted small' }, t('leds.presetNone')),
    el('div', { class: 'actions' }, nameIn, el('button', { class: 'btn', onclick: () => {
      const name = nameIn.value.trim().slice(0, 24);
      if (!name || L.presets.length >= 24) return;
      const at = L.presets.findIndex(p => p.name === name), snap = { name, segments: structuredClone(L.segments) };
      if (at >= 0) L.presets[at] = snap; else L.presets.push(snap);
      rebuild();
    } }, icon('play'), t('leds.presetSave'))),
    el('h4', {}, t('leds.playlist')),
    el('p', { class: 'muted small' }, t('leds.playlistHint')),
    checkbox(t('leds.on'), L.playlist, 'enabled'),
    ...L.playlist.items.map((it, i) => el('div', { class: 'row' },
      select(L.presets.map(p => [p.name, p.name]), it.preset, v => { it.preset = v; done(); }),
      el('input', { type: 'number', class: 'n', min: 1, max: 3600, value: it.sec, onchange: e => { it.sec = clampN(e.target.value, 1, 3600); done(); } }), el('span', { class: 'small' }, t('leds.sec')),
      el('button', { class: 'btn', onclick: () => { L.playlist.items.splice(i, 1); rebuild(); } }, icon('trash')))),
    el('button', { class: 'btn', disabled: !L.presets.length || L.playlist.items.length >= 12, onclick: () => { L.playlist.items.push({ preset: L.presets[0].name, sec: 10 }); rebuild(); } }, icon('plus'), t('leds.playlistAdd')));

  const datalist = el('datalist', { id: 'led-paths' }, LED_PATHS.map(p => el('option', { value: p })));

  const testBtn = el('button', { class: 'btn', onclick: async () => {
    try { await api('POST', '/api/led-test', { id: d.id, sec: 60 }); } catch { /* the preview says it */ }
  } }, icon('play'), t('leds.test'));
  const testEnd = el('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/led-test', { id: d.id, sec: 0 }); } catch { /* ignore */ } } }, t('leds.testEnd'));

  return el('div', { class: `card ${d.enabled ? '' : 'dim'}`, 'data-leds': d.id },
    el('div', { class: 'chead' }, icon('bulb'), el('h2', {}, d.name), el('span', { class: 'grow' }),
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: L.enabled, onchange: e => { L.enabled = e.target.checked; rebuild(); } }), el('span', {}, t('leds.use')))),
    el('p', { class: 'muted small' }, t('leds.useHint')),
    el('div', { class: 'ledwrap' }, strip),
    el('div', { class: 'row small' }, stateLine, el('span', { class: 'grow' }), el('span', { class: 'muted' }, t('leds.preview'))),
    errs,
    el('div', { class: 'actions' },
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.sleep.leds, onchange: e => { d.sleep.leds = e.target.checked; touch(); } }), el('span', {}, t('leds.sleep'))),
      testBtn, testEnd),
    el('p', { class: 'muted small' }, t('leds.sleepHint')),
    general, segs, templates, presets, datalist);
}

// --- painting (called for every socket message and after a render) ---------------------------------

function ledMarkCells(d, strip) {
  const starts = new Set(d.leds.segments.map(s => s.start));
  const open = LED.open[d.id], sel = open != null ? d.leds.segments[open] : null;
  [...strip.children].forEach((cell, i) => {
    cell.classList.toggle('first', starts.has(i) && i > 0);
    cell.classList.toggle('sel', !!sel && i >= sel.start && i < sel.start + sel.len);
  });
}

function ledMarkSwatches(d) {
  d.leds.segments.forEach((seg, i) => {
    const sw = document.querySelector(`#page-leds [data-leds="${d.id}"] .segswatch[data-seg="${i}"]`);
    if (sw) sw.style.background = seg.mode === 'bar' ? seg.bar.stops[0][1] : seg.look.c1;
  });
}

function paintLeds() {
  for (const strip of document.querySelectorAll('#page-leds .ledstrip[data-dev]')) {
    const id = strip.dataset.dev, f = state.ledFrames?.[id];
    [...strip.children].forEach((cell, i) => {
      if (!f || i * 6 + 6 > f.hex.length) { cell.style.background = ''; cell.classList.add('dark'); return; }
      const r = parseInt(f.hex.slice(i * 6, i * 6 + 2), 16), g = parseInt(f.hex.slice(i * 6 + 2, i * 6 + 4), 16), b = parseInt(f.hex.slice(i * 6 + 4, i * 6 + 6), 16);
      cell.classList.toggle('dark', r + g + b === 0);
      cell.style.background = r + g + b === 0 ? '' : `rgb(${r},${g},${b})`;
    });
    const line = document.querySelector(`#page-leds [data-role=ledstate][data-dev="${id}"]`);
    if (line) line.textContent = f ? t(f.awake ? 'leds.awake' : 'leds.dark') : '';
    const err = document.querySelector(`#page-leds [data-role=lederr][data-dev="${id}"]`);
    if (err) err.textContent = f?.errors?.length ? `${t('leds.errors')}: ${[...new Set(f.errors)].slice(0, 3).join(' · ')}` : '';
  }
}
