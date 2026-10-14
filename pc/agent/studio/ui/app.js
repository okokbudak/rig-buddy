'use strict';
// Rig Buddy Studio page. No framework: render functions build a page once, paint functions
// update the live parts (needles, values, states) from the WebSocket without touching inputs.
// Texts live in i18n.js (t(), PRESETS, LANG).

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};

const ICONS = {
  gauge: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M8 13a4 4 0 0 1 4-4"/>',
  display: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plug: '<path d="M9 7V3M15 7V3M6 7h12v3a6 6 0 0 1-12 0z"/><path d="M12 16v5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.5-4.5"/>',
  truck: '<rect x="2" y="6" width="12" height="10" rx="1"/><path d="M14 9h4l3 3.5V16h-7"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  touch: '<path d="M9 12V5a1.5 1.5 0 0 1 3 0v6M12 10V9a1.5 1.5 0 0 1 3 0v3M15 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L3.5 15a1.5 1.5 0 0 1 2.5-1.6L9 16"/>',
};
function icon(name, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `ic ${cls}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] ?? ''; // static markup from the table above
  return s;
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'X-Studio': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const TABS = [['cockpit', 'gauge'], ['board', 'cpu'], ['display', 'display'], ['connections', 'plug'], ['data', 'search']];
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];
const NX_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 512000, 921600];
const LINE_ENDS = [['\\n', 'LF (\\n)'], ['\\r\\n', 'CR+LF'], ['\\r', 'CR'], ['', '—']];
const PROPS = ['txt', 'vis', 'val', 'pic', 'pco', 'bco'];

const state = {
  catalog: [], config: { serial: [], nextion: [] }, ports: [], status: null, values: {},
  tab: 'cockpit', visible: [], open: null, nxFilter: {}, testing: {}, boardSel: {}, boardMsg: {},
};

const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const presetOf = c => PRESETS.find(p => p.id === c.preset) ?? null;
const presetLabel = p => p[LANG] ?? p.en;
const statusOf = id => state.status?.devices?.find(x => x.id === id);
const nxStatusOf = id => state.status?.nextion?.find(x => x.id === id);

// --- saving -------------------------------------------------------------------------------------

let saveTimer = null;
function touch() {
  $('#saveState').textContent = t('save.saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const saved = await api('PUT', '/api/config', state.config);
      state.config.rev = saved.rev;
      $('#saveState').textContent = t('save.saved');
    } catch (e) {
      if (e.message === 'stale') {
        // the settings changed somewhere else since this page loaded: never overwrite them
        $('#saveState').textContent = t('save.stale');
        setTimeout(() => location.reload(), 2500);
        return;
      }
      $('#saveState').textContent = t('save.failed', { msg: e.message });
    }
  }, 500);
}

// --- live socket ------------------------------------------------------------------------------

let ws = null;
function connectLive() {
  ws = new WebSocket(`ws://${location.host}/live`);
  ws.onopen = sendWatch;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    state.status = m.status;
    state.values = m.values;
    paint();
  };
  ws.onclose = () => {
    state.status = null;
    paintPills();
    setTimeout(connectLive, 1500);
  };
}
function sendWatch() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ watch: state.tab === 'data' ? state.visible : [] }));
}

// --- frame: tabs, language, status pills --------------------------------------------------------

function renderTabs() {
  $('#tabs').replaceChildren(...TABS.map(([name, ic]) => el('button', {
    class: `tab ${state.tab === name ? 'on' : ''}`, onclick: () => showTab(name),
  }, icon(ic), el('span', {}, t(`tab.${name}`)))));
}

function renderLang() {
  $('#lang').replaceChildren(...[['tr', 'Türkçe'], ['en', 'English']].map(([code, label]) => el('button', {
    class: LANG === code ? 'on' : '', 'aria-pressed': String(LANG === code),
    onclick: () => { setLang(code); renderAll(); },
  }, label)));
}

function showTab(name) {
  state.tab = name;
  renderTabs();
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `page-${name}`;
  history.replaceState(null, '', `#${name}`);
  renderPage(name);
  sendWatch();
  window.scrollTo(0, 0);
}

function renderPage(name) {
  if (name === 'cockpit') renderCockpit();
  else if (name === 'board') renderBoard();
  else if (name === 'display') renderDisplay();
  else if (name === 'connections') renderConnections();
  else if (name === 'data') renderData();
  paint();
}

function renderAll() {
  renderTabs();
  renderLang();
  renderPage(state.tab);
}

function stateLabel(st, enabled, hasPort) {
  if (!enabled) return ['off', t('state.off')];
  if (!hasPort) return ['warn', t('state.noPort')];
  const s = st?.state ?? 'off';
  if (st?.asleep) return ['idle', t('state.asleep')];
  return [{ open: 'ok', connecting: 'warn', error: 'bad' }[s] ?? 'off', t(`state.${s}`)];
}

function paintPills() {
  const s = state.status;
  const pills = [];
  if (!s) pills.push(el('span', { class: 'pill bad' }, icon('info'), t('pill.agent')));
  else {
    pills.push(el('span', { class: `pill ${s.game ? 'ok' : 'off'}` }, icon('truck'), t(s.game ? 'pill.gameOn' : 'pill.gameOff')));
    if (!s.hub) pills.push(el('span', { class: 'pill bad' }, icon('plug'), t('pill.hubOff')));
    for (const d of state.config.serial.filter(x => x.enabled)) {
      const [cls, label] = stateLabel(statusOf(d.id), true, !!d.port);
      pills.push(el('button', { class: `pill ${cls}`, onclick: () => showTab('cockpit') }, icon('cpu'), `${d.name} · ${label}${d.port ? ` · ${d.port}` : ''}`));
    }
    for (const d of state.config.nextion.filter(x => x.enabled)) {
      const st = nxStatusOf(d.id);
      const [cls, label] = stateLabel(st, true, !!(d.port || d.via));
      const page = st?.page && st.state === 'open' && !st.asleep ? ` · ${st.page}` : '';
      pills.push(el('button', { class: `pill ${cls}`, onclick: () => showTab('display') }, icon('display'), `${d.name} · ${label}${page}`));
    }
  }
  $('#pills').replaceChildren(...pills);
}

function paint() {
  paintPills();
  if (state.tab === 'cockpit') paintCockpit();
  else if (state.tab === 'board') paintBoard();
  else if (state.tab === 'display') paintDisplay();
  else if (state.tab === 'connections') paintConnections();
  else if (state.tab === 'data') paintData();
}

function header(title, lead) {
  return el('header', { class: 'phead' }, el('h1', {}, title), lead ? el('p', { class: 'lead' }, lead) : null);
}

function select(options, value, onchange, attrs = {}) {
  const s = el('select', { ...attrs, onchange: () => onchange(s.value) },
    options.map(([v, label]) => el('option', { value: v, selected: String(v) === String(value) }, label)));
  return s;
}

function field(label, control, hint) {
  return el('label', { class: 'field' }, el('span', { class: 'flabel' }, label), control, hint ? el('span', { class: 'fhint' }, hint) : null);
}

function emptyState(ic, title, lead, button) {
  return el('div', { class: 'empty' }, icon(ic, 'big'), el('h2', {}, title), el('p', {}, lead), button);
}

// --- cockpit: the gauges ------------------------------------------------------------------------

const DIAL = { size: 120, cx: 60, cy: 62, r: 46 };
const rad = deg => ((deg - 90) * Math.PI) / 180;
const polar = (r, deg) => [DIAL.cx + r * Math.cos(rad(deg)), DIAL.cy + r * Math.sin(rad(deg))];

function realValue(c, sent) {
  if (sent == null) return null;
  if (c.lo != null && c.hi != null && c.min != null && c.max != null && c.max !== c.min) {
    return c.lo + ((sent - c.min) / (c.max - c.min)) * (c.hi - c.lo);
  }
  return sent;
}
function fmtGauge(c, v) {
  if (v == null || !Number.isFinite(v)) return '–';
  const span = c.lo != null && c.hi != null ? Math.abs(c.hi - c.lo) : Math.abs((c.max ?? 1000) - (c.min ?? 0));
  const s = span <= 20 ? (Math.round(v * 10) / 10).toLocaleString(LANG) : Math.round(v).toLocaleString(LANG);
  return c.unit ? `${s} ${c.unit}` : s;
}
const fmtEnd = (c, v) => (v == null ? '' : `${Math.round(v * 10) / 10}`);

function dialSvg(c) {
  const s = svg('svg', { viewBox: `0 0 ${DIAL.size} 112`, class: 'dialsvg', role: 'img' });
  const [x1, y1] = polar(DIAL.r, -120), [x2, y2] = polar(DIAL.r, 120);
  s.append(svg('path', { d: `M${x1} ${y1} A${DIAL.r} ${DIAL.r} 0 1 1 ${x2} ${y2}`, class: 'arc' }));
  for (let k = 0; k <= 10; k++) {
    const a = -120 + 24 * k, major = k % 5 === 0;
    const [ax, ay] = polar(DIAL.r - 3, a), [bx, by] = polar(DIAL.r - (major ? 11 : 7), a);
    s.append(svg('line', { x1: ax, y1: ay, x2: bx, y2: by, class: major ? 'tick major' : 'tick' }));
  }
  const lo = c.lo != null && c.hi != null ? c.lo : c.min, hi = c.lo != null && c.hi != null ? c.hi : c.max;
  // range labels just under the two ends of the scale, clear of the needle
  s.append(svg('text', { x: x1, y: y1 + 16, class: 'end', 'text-anchor': 'middle' }, fmtEnd(c, lo)));
  s.append(svg('text', { x: x2, y: y2 + 16, class: 'end', 'text-anchor': 'middle' }, fmtEnd(c, hi)));
  const needle = svg('g', { class: 'needle', 'data-role': 'needle' },
    svg('line', { x1: DIAL.cx, y1: DIAL.cy + 8, x2: DIAL.cx, y2: DIAL.cy - DIAL.r + 8 }));
  needle.style.transform = 'rotate(-120deg)';
  s.append(needle, svg('circle', { cx: DIAL.cx, cy: DIAL.cy, r: 4.5, class: 'hub' }));
  return s;
}

function renderCockpit() {
  const page = $('#page-cockpit');
  const kids = [header(t('cockpit.title'), t('cockpit.lead'))];
  if (!state.config.serial.length) {
    kids.push(emptyState('gauge', t('cockpit.empty'), t('cockpit.emptyLead'),
      el('button', { class: 'btn primary', onclick: () => showTab('connections') }, t('cockpit.gotoConnections'))));
  }
  for (const d of state.config.serial) kids.push(boardCard(d));
  page.replaceChildren(...kids);
}

function boardCard(d) {
  const card = el('div', { class: `card board ${d.enabled ? '' : 'dim'}`, 'data-dev': d.id });
  const dials = el('div', { class: 'dials' }, d.channels.map((c, i) => {
    const open = state.open?.dev === d.id && state.open.ch === i;
    return el('button', {
      class: `dial ${open ? 'open' : ''}`, 'data-ch': i, 'aria-expanded': String(open),
      onclick: () => { state.open = open ? null : { dev: d.id, ch: i }; renderCockpit(); paint(); },
    }, d.board ? el('span', { class: `dmotor ${d.motors[i]?.enabled ? '' : 'off'}` }, t('board.socket', { n: i })) : null,
    dialSvg(c), el('span', { class: 'dname' }, c.name || (d.board ? t('board.free') : t('cockpit.newGauge', { n: i + 1 }))), el('span', { class: 'dval', 'data-role': 'val' }, '–'));
  }));
  if (d.enabled && !d.board) { // a board's gauges are its motor sockets: no adding
    dials.append(el('button', { class: 'dial add', onclick: () => addGauge(d) }, icon('plus', 'big'), el('span', { class: 'dname' }, t('cockpit.addGauge'))));
  }
  card.append(el('div', { class: 'chead' },
    icon('cpu'), el('h2', {}, d.name),
    el('span', { class: 'badge', 'data-role': 'badge' }),
    el('span', { class: 'grow' }),
    el('span', { class: 'muted small' }, d.port || '')));
  if (!d.enabled) card.append(el('p', { class: 'muted' }, t('cockpit.disabled')));
  card.append(dials);
  if (state.open?.dev === d.id && d.channels[state.open.ch]) card.append(gaugeEditor(d, state.open.ch));
  return card;
}

function addGauge(d) {
  d.channels.push({ name: t('cockpit.newGauge', { n: d.channels.length + 1 }), expr: '', min: 0, max: 1000, lo: null, hi: null, unit: '', preset: '' });
  state.open = { dev: d.id, ch: d.channels.length - 1 };
  renderCockpit();
  paint();
  touch();
}

function refreshDials(d, i) {
  // the end labels changed: redraw this gauge's dials (small and big) but keep the inputs
  for (const holder of document.querySelectorAll(`[data-dev="${d.id}"] [data-ch="${i}"]`)) {
    const old = holder.querySelector('svg.dialsvg');
    if (old) old.replaceWith(dialSvg(d.channels[i]));
  }
  paint();
}

function gaugeEditor(d, i) {
  const c = d.channels[i];
  const p = presetOf(c);
  const custom = !p;
  const changed = () => { refreshDials(d, i); touch(); };

  const name = el('input', { type: 'text', value: c.name, oninput: e => {
    c.name = e.target.value;
    const label = document.querySelector(`[data-dev="${d.id}"] .dials [data-ch="${i}"] .dname`);
    if (label) label.textContent = c.name || t('cockpit.newGauge', { n: i + 1 });
    touch();
  } });

  const empty = d.board && !c.expr && !c.preset;
  const what = select([...(d.board ? [['__none', t('board.free')]] : []), ...PRESETS.map(x => [x.id, presetLabel(x)]), ['', t('gauge.custom')]], empty ? '__none' : c.preset || '', v => {
    const np = PRESETS.find(x => x.id === v);
    if (v === '__none') Object.assign(c, { name: '', expr: '', preset: '', unit: '', lo: null, hi: null }); // a free socket
    else if (np) {
      const oldLabel = presetOf(c) ? presetLabel(presetOf(c)) : '';
      if (!c.name || c.name === oldLabel || /^(Gösterge|Gauge) \d+$/.test(c.name)) c.name = presetLabel(np);
      Object.assign(c, { preset: np.id, expr: np.expr, unit: np.unit, lo: np.lo, hi: np.hi });
      if (c.min == null) c.min = 0;
      if (c.max == null) c.max = 1000;
    } else c.preset = '';
    renderCockpit();
    paint();
    touch();
  });

  const unitTag = () => el('span', { class: 'unit' }, c.unit || '');
  const num = (key, hint) => el('div', { class: 'withunit' },
    el('input', { type: 'number', step: 'any', value: c[key] ?? '', title: hint, oninput: e => { c[key] = numOrNull(e.target.value); changed(); } }), unitTag());

  const formula = el('input', { type: 'text', class: 'mono', value: c.expr, spellcheck: 'false', autocomplete: 'off', placeholder: 'truck.speed.kph', 'data-role': 'formula' });
  formula.addEventListener('input', () => { c.expr = formula.value; touch(); });
  attachSuggest(formula, () => { c.expr = formula.value; touch(); });

  const testMsg = el('span', { class: 'muted small', 'data-role': 'testmsg' });
  const testBtn = el('button', { class: 'btn', onclick: async () => {
    try {
      await api('POST', '/api/test', { id: d.id, channel: i, ms: 3000 });
      testMsg.textContent = t('gauge.testing');
      setTimeout(() => { testMsg.textContent = ''; }, 3200);
    } catch (e) { testMsg.textContent = e.message; }
  } }, icon('play'), t('gauge.test'));

  const big = el('div', { class: 'bigdial', 'data-ch': i }, dialSvg(c), el('div', { class: 'dval big', 'data-role': 'val' }, '–'));

  return el('div', { class: 'editor', 'data-ch-editor': i },
    el('div', { class: 'ehead' },
      el('h3', {}, d.board ? t('board.socket', { n: i }) : t('gauge.title', { n: i + 1 })),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn ghost icon', 'aria-label': t('gauge.close'), onclick: () => { state.open = null; renderCockpit(); paint(); } }, icon('x'))),
    el('div', { class: 'egrid' },
      big,
      el('div', { class: 'efields' },
        field(t('gauge.name'), name),
        field(t('gauge.what'), what),
        custom ? field(t('gauge.formula'), formula, t('gauge.formulaHint')) : null,
        custom ? field(t('gauge.unit'), el('input', { type: 'text', value: c.unit, maxlength: 12, style: 'width:110px', oninput: e => { c.unit = e.target.value; changed(); } })) : null,
        el('div', { class: 'row2' },
          field(t('gauge.lo'), num('lo', t('gauge.loHint')), t('gauge.loHint')),
          field(t('gauge.hi'), num('hi', t('gauge.hiHint')), t('gauge.hiHint'))),
        custom && (c.lo == null || c.hi == null) ? el('p', { class: 'muted small' }, t('gauge.rawNote')) : null,
        el('p', { class: 'err', 'data-role': 'ederr' }),
        d.board ? el('div', { class: 'row2' },
          field(t('board.moveTo'), select(d.channels.map((x, j) => [String(j), `${t('board.socket', { n: j })}${x.expr ? ` · ${x.name}` : ` · ${t('board.free')}`}`]), String(i), v => {
            const j = Number(v);
            if (j === i) return;
            [d.channels[i], d.channels[j]] = [d.channels[j], d.channels[i]];
            state.open = { dev: d.id, ch: j };
            renderCockpit();
            paint();
            touch();
          }), t('board.moveHint')),
          el('div', { class: 'field' }, el('span', { class: 'flabel' }, t('board.motorLink')),
            el('button', { class: 'btn', onclick: () => { state.boardSel[d.id] = i; showTab('board'); } }, icon('cpu'), `${t('board.socket', { n: i })} · ${t('tab.board')}`))) : null,
        d.board ? null : el('details', { class: 'adv' },
          el('summary', {}, t('gauge.advanced')),
          el('div', { class: 'row2' },
            field(`${t('gauge.board')} · ${t('gauge.lo').toLowerCase()}`, el('input', { type: 'number', value: c.min ?? '', oninput: e => { c.min = numOrNull(e.target.value); changed(); } })),
            field(`${t('gauge.board')} · ${t('gauge.hi').toLowerCase()}`, el('input', { type: 'number', value: c.max ?? '', oninput: e => { c.max = numOrNull(e.target.value); changed(); } }))),
          el('p', { class: 'fhint' }, t('gauge.boardHint')),
          custom ? null : field(t('gauge.formula'), el('code', { class: 'formula-ro' }, c.expr))),
        el('div', { class: 'actions' },
          testBtn, testMsg,
          el('span', { class: 'grow' }),
          el('button', { class: 'btn danger', onclick: () => {
            if (!confirm(t('gauge.removeAsk', { name: c.name || t('gauge.title', { n: i + 1 }) }))) return;
            d.channels.splice(i, 1);
            state.open = null;
            renderCockpit();
            paint();
            touch();
          } }, icon('trash'), t('gauge.remove'))))));
}

function paintCockpit() {
  for (const d of state.config.serial) {
    const card = document.querySelector(`#page-cockpit [data-dev="${d.id}"]`);
    if (!card) continue;
    const st = statusOf(d.id);
    const [cls, label] = stateLabel(st, d.enabled, !!d.port);
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    d.channels.forEach((c, i) => {
      const sent = st?.values?.[i];
      const err = st?.errors?.[i];
      const frac = sent != null && c.min != null && c.max != null && c.max !== c.min ? Math.min(1, Math.max(0, (sent - c.min) / (c.max - c.min))) : 0;
      for (const holder of card.querySelectorAll(`[data-ch="${i}"]`)) {
        const needle = holder.querySelector('[data-role=needle]');
        if (needle) needle.style.transform = `rotate(${-120 + 240 * frac}deg)`;
        const val = holder.querySelector('[data-role=val]');
        if (val) val.textContent = fmtGauge(c, realValue(c, sent));
        holder.classList.toggle('bad', !!err);
      }
      const ed = card.querySelector(`[data-ch-editor="${i}"] [data-role=ederr]`);
      if (ed) ed.textContent = err ? t('gauge.error', { msg: err }) : '';
    });
  }
}

// --- board: motor sockets of a board that keeps its own settings (Octopus) ----------------------

const SOCKETS = 8; // the Octopus has 8 driver sockets; the firmware drives the first `motors.length`
const MICROSTEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

async function boardOp(d, op) {
  state.boardMsg[d.id] = { kind: 'busy', text: t(op === 'upload' ? 'board.uploading' : op === 'read' ? 'board.reading' : 'board.adopting') };
  paintBoard();
  if (op === 'upload') {
    // the board must get exactly what is shown: save pending edits first
    clearTimeout(saveTimer);
    try {
      const saved = await api('PUT', '/api/config', state.config);
      state.config.rev = saved.rev;
    } catch (e) {
      state.boardMsg[d.id] = { kind: 'bad', text: t('board.failed', { msg: e.message }) };
      paintBoard();
      return;
    }
  }
  try {
    const r = await api('POST', `/api/board/${op}`, { id: d.id });
    if (!r.ok) throw new Error(r.error);
    if (op === 'adopt') state.config = r.config;
    state.boardMsg[d.id] = { kind: 'ok', text: t(op === 'upload' ? 'board.uploaded' : op === 'read' ? 'board.readOk' : 'board.adopted') };
    if (op === 'adopt') { renderAll(); return; }
  } catch (e) {
    state.boardMsg[d.id] = { kind: 'bad', text: t('board.failed', { msg: e.message }) };
  }
  paintBoard();
}

function renderBoard() {
  const page = $('#page-board');
  const kids = [header(t('board.title'), t('board.lead'))];
  if (!state.config.serial.length) {
    kids.push(emptyState('cpu', t('board.empty'), t('board.emptyLead'),
      el('button', { class: 'btn primary', onclick: () => showTab('connections') }, t('cockpit.gotoConnections'))));
  }
  for (const d of state.config.serial) kids.push(d.board ? boardPcbCard(d) : boardGenericCard(d));
  page.replaceChildren(...kids);
}

function boardGenericCard(d) {
  return el('div', { class: `card ${d.enabled ? '' : 'dim'}`, 'data-board': d.id },
    el('div', { class: 'chead' }, icon('cpu'), el('h2', {}, d.name), el('span', { class: 'badge', 'data-role': 'badge' }), el('span', { class: 'grow' }), el('span', { class: 'muted small' }, d.port || '')),
    el('p', { class: 'muted' }, t('board.generic')),
    el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => boardOp(d, 'adopt') }, icon('info'), t('board.adopt')),
      el('span', { class: 'small', 'data-role': 'boardmsg' })));
}

function displayOn(d) {
  return state.config.nextion.find(n => n.via === d.id);
}

function boardPcbCard(d) {
  const sel = Math.min(state.boardSel[d.id] ?? 0, d.motors.length - 1);
  const select_ = i => { state.boardSel[d.id] = i; renderBoard(); paint(); };
  const nx = displayOn(d);

  const sockets = el('div', { class: 'sockets' }, Array.from({ length: SOCKETS }, (_, i) => {
    const m = d.motors[i], c = d.channels[i];
    if (!m) return el('div', { class: 'socket na' }, el('span', { class: 'sname' }, t('board.socket', { n: i })), el('span', { class: 'sgauge' }, t('board.notUsed')));
    const label = !m.enabled ? t('board.off') : (c?.expr ? (c.name || t('cockpit.newGauge', { n: i + 1 })) : t('board.free'));
    return el('button', {
      class: `socket ${i === sel ? 'sel' : ''} ${m.enabled ? (c?.expr ? 'used' : 'free') : 'off'}`, 'data-sock': i, onclick: () => select_(i),
    }, el('span', { class: 'sname' }, t('board.socket', { n: i })), el('span', { class: 'chip' }), el('span', { class: 'sgauge' }, label), el('span', { class: 'sneedle', 'data-role': 'sval' }));
  }));

  const pcb = el('div', { class: 'pcb' },
    el('div', { class: 'pcbtitle' }, 'BTT Octopus Pro'),
    sockets,
    el('div', { class: 'ports' },
      el('span', { class: 'port usb' }, icon('plug'), t('board.usb', { port: d.port || '–' })),
      el('span', { class: `port tft ${nx ? 'on' : ''}` }, icon('display'), nx ? t('board.tft', { name: nx.name }) : t('board.tftEmpty'))));

  // the selected socket
  const m = d.motors[sel], c = d.channels[sel];
  const set = (key, v) => { m[key] = v; touch(); paintBoard(); };
  const numIn = (key, attrs = {}) => el('input', { type: 'number', class: 'n', value: m[key], ...attrs, onchange: e => set(key, Number(e.target.value)) });
  const testMsg = el('span', { class: 'muted small' });
  const panel = el('div', { class: 'sockpanel' },
    el('div', { class: 'ehead' }, el('h3', {}, `${t('board.socket', { n: sel })}${c?.expr ? ` · ${c.name}` : ''}`)),
    el('div', { class: 'gaugeline' },
      el('span', { class: 'flabel' }, t('board.gauge')),
      c?.expr ? el('span', {}, c.name, c.preset && presetOf(c) && presetLabel(presetOf(c)) !== c.name ? el('span', { class: 'muted small' }, ` · ${presetLabel(presetOf(c))}`) : null) : el('span', { class: 'muted' }, t('board.noGauge')),
      el('button', { class: 'btn', onclick: () => { state.open = { dev: d.id, ch: sel }; showTab('cockpit'); } }, icon('gauge'), t('board.editGauge')),
      el('button', { class: 'btn', onclick: async () => {
        try { await api('POST', '/api/test', { id: d.id, channel: sel, ms: 3000 }); testMsg.textContent = t('gauge.testing'); setTimeout(() => { testMsg.textContent = ''; }, 3200); } catch (e) { testMsg.textContent = e.message; }
      } }, icon('play'), t('board.test')), testMsg),
    el('div', { class: 'fields' },
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: m.enabled, onchange: e => { m.enabled = e.target.checked; touch(); renderBoard(); paint(); } }), el('span', {}, t('board.motorOn'))),
      field(t('board.dir'), select([['0', t('board.dirNormal')], ['1', t('board.dirReverse')]], m.dir ? '1' : '0', v => set('dir', v === '1')), t('board.dirHint')),
      field(t('board.current'), numIn('ma', { min: 30, max: 1500, step: 10 }), t('board.currentHint')),
      field(t('board.hold'), numIn('hold', { min: 0, max: 100 }), t('board.holdHint')),
      field(t('board.sweep'), numIn('sweep', { min: 10, max: 360, step: 0.1 }), t('board.sweepHint'))),
    el('details', { class: 'adv' },
      el('summary', {}, t('gauge.advanced')),
      el('div', { class: 'fields' },
        field(t('board.motorType'), select([['200', t('board.spr200')], ['400', t('board.spr400')], ...(![200, 400].includes(m.spr) ? [[String(m.spr), String(m.spr)]] : [])], String(m.spr), v => set('spr', Number(v)))),
        field(t('board.microsteps'), select(MICROSTEPS.map(x => [String(x), String(x)]), String(m.ms), v => set('ms', Number(v)))),
        field(t('board.speed'), numIn('vmax', { min: 1, max: 3000 })),
        field(t('board.accel'), numIn('acc', { min: 1, max: 60000, step: 100 })),
        field(t('board.sg'), numIn('sg', { min: 0, max: 255 }))),
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: m.home, onchange: e => set('home', e.target.checked) }), el('span', {}, t('board.homeOnBoot')))));

  // the power output (FAN0): switches the head unit with the ignition
  const pw = d.power;
  const pwMsg = el('span', { class: 'muted small' });
  const powerPanel = el('div', { class: 'sockpanel' },
    el('div', { class: 'ehead' }, el('h3', {}, t('power.title')), el('span', { class: 'pill off', 'data-role': 'powerstate' })),
    el('p', { class: 'muted small' }, t('power.lead')),
    el('div', { class: 'fields' },
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: pw.enabled, onchange: e => { pw.enabled = e.target.checked; touch(); renderBoard(); paint(); } }), el('span', {}, t('power.on'))),
      pw.enabled ? field(t('power.expr'), el('input', { type: 'text', class: 'mono', value: pw.expr, onchange: e => { pw.expr = e.target.value; touch(); } }), t('power.exprHint')) : null,
      pw.enabled ? field(t('power.delay'), el('input', { type: 'number', class: 'n', min: 0, max: 3600, value: pw.offDelay, onchange: e => { pw.offDelay = Number(e.target.value); touch(); } }), t('power.delayHint')) : null),
    pw.enabled ? el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: async () => {
        try { await api('POST', '/api/test-power', { id: d.id, ms: 5000 }); pwMsg.textContent = t('power.testing'); setTimeout(() => { pwMsg.textContent = ''; }, 5200); } catch (e) { pwMsg.textContent = e.message; }
      } }, icon('play'), t('power.test')), pwMsg) : null);

  return el('div', { class: `card ${d.enabled ? '' : 'dim'}`, 'data-board': d.id },
    el('div', { class: 'chead' },
      icon('cpu'), el('h2', {}, d.name),
      el('span', { class: 'badge', 'data-role': 'badge' }),
      el('span', { class: 'muted small', 'data-role': 'fw' }),
      el('span', { class: 'grow' }),
      el('span', { class: 'pill', 'data-role': 'sync' })),
    pcb,
    panel,
    powerPanel,
    el('div', { class: 'actions boardactions' },
      el('button', { class: 'btn primary', 'data-role': 'upload', onclick: () => boardOp(d, 'upload') }, icon('play'), t('board.upload')),
      el('button', { class: 'btn', onclick: () => boardOp(d, 'read') }, icon('refresh'), t('board.read')),
      el('span', { class: 'small', 'data-role': 'boardmsg' })));
}

function paintBoard() {
  for (const d of state.config.serial) {
    const card = document.querySelector(`#page-board [data-board="${d.id}"]`);
    if (!card) continue;
    const st = statusOf(d.id);
    const [cls, label] = stateLabel(st, d.enabled, !!d.port);
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    const msg = state.boardMsg[d.id];
    const msgEl = card.querySelector('[data-role=boardmsg]');
    msgEl.textContent = msg ? msg.text : (st?.state === 'open' || !d.enabled ? '' : t('board.notConnected'));
    msgEl.className = `small ${msg?.kind === 'bad' ? 'err' : msg?.kind === 'ok' ? 'okc' : 'muted'}`;
    if (!d.board) continue;
    const b = st?.board;
    card.querySelector('[data-role=fw]').textContent = b?.version ? t('board.firmware', { v: b.version }) : '';
    const sync = card.querySelector('[data-role=sync]');
    if (!b) { sync.className = 'pill off'; sync.textContent = t('board.syncUnknown'); }
    else if (b.differs.length || !b.saved) {
      sync.className = 'pill warn';
      sync.textContent = t('board.syncDiff', { list: b.differs.map(i => t('board.socket', { n: i })).join(', ') || '–' });
    } else { sync.className = 'pill ok'; sync.textContent = t('board.syncOk'); }
    const ps = card.querySelector('[data-role=powerstate]');
    const p = st?.power;
    if (!d.power.enabled) ps.textContent = '';
    else if (p?.error) { ps.className = 'pill warn'; ps.textContent = t('power.error', { msg: p.error }); }
    else if (!p) { ps.className = 'pill off'; ps.textContent = t('power.waiting'); }
    else if (p.on) { ps.className = 'pill ok'; ps.textContent = p.want ? t('power.stateOn') : t('power.stateHold', { s: p.holdLeft }); }
    else { ps.className = 'pill off'; ps.textContent = t('power.stateOff'); }
    if (d.power.enabled && b && !b.power) { ps.className = 'pill warn'; ps.textContent = t('power.oldFw'); }
    for (const btn of card.querySelectorAll('[data-sock]')) {
      const i = Number(btn.dataset.sock), c = d.channels[i];
      const v = st?.values?.[i];
      btn.querySelector('[data-role=sval]').textContent = c?.expr && v != null ? fmtGauge(c, realValue(c, v)) : '';
      btn.classList.toggle('diff', !!b?.differs?.includes(i));
    }
  }
}

// --- display: Nextion screens -------------------------------------------------------------------

function spotLabel(h) {
  if (h.action === 'next') return t('display.actNext');
  if (h.action === 'prev') return t('display.actPrev');
  return t('display.actGo', { page: h.action.slice(5) });
}

function renderDisplay() {
  const page = $('#page-display');
  const kids = [header(t('display.title'), t('display.lead'))];
  if (!state.config.nextion.length) kids.push(emptyState('display', t('display.empty'), t('display.emptyLead'), null));
  for (const d of state.config.nextion) kids.push(displayCard(d));
  kids.push(el('div', { class: 'below' }, el('button', { class: 'btn', onclick: addDisplay }, icon('plus'), t('display.add'))));
  page.replaceChildren(...kids);
}

function addDisplay() {
  state.config.nextion.push({
    id: `nx${Date.now() % 100000}`, name: t('display.newName', { n: state.config.nextion.length + 1 }), enabled: false, port: '', via: '', baud: 115200,
    width: 480, height: 272, powerOffWhenIdle: false, idlePage: 'page0', pages: [{ name: 'page1', rotation: true, showWhen: '' }], hotspots: [], bindings: [],
  });
  renderDisplay();
  paint();
  touch();
}

// which display cards are folded to their header (kept in this browser only)
const collapsedIds = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('studio.collapsed') || '[]')); } catch { return new Set(); }
})();
function saveCollapsed() {
  try { localStorage.setItem('studio.collapsed', JSON.stringify([...collapsedIds])); } catch { /* private window: it just won't be remembered */ }
}

function displayCard(d) {
  d.via ??= '';
  d.widgets ??= [];
  const card = el('div', { class: `card ${d.enabled ? '' : 'dim'} ${collapsedIds.has(d.id) ? 'collapsed' : ''}`, 'data-nx': d.id });
  const foldBtn = el('button', { class: 'btn ghost icon fold' });
  const paintFold = () => {
    const folded = collapsedIds.has(d.id);
    foldBtn.replaceChildren(icon(folded ? 'plus' : 'minus'));
    foldBtn.setAttribute('aria-label', t(folded ? 'display.expand' : 'display.collapse'));
    foldBtn.setAttribute('aria-expanded', String(!folded));
    foldBtn.title = t(folded ? 'display.expand' : 'display.collapse');
    card.classList.toggle('collapsed', folded);
  };
  foldBtn.addEventListener('click', () => {
    if (collapsedIds.has(d.id)) collapsedIds.delete(d.id); else collapsedIds.add(d.id);
    saveCollapsed();
    paintFold();
  });
  paintFold();
  const nav = action => api('POST', '/api/nextion/nav', { id: d.id, action }).catch(() => {});
  const rebuild = () => { renderDisplay(); paint(); touch(); };

  // a picture of the screen with its touch areas
  const screen = el('div', { class: `screen ${d.height > d.width ? 'tall' : ''}`, style: `aspect-ratio:${d.width} / ${d.height}` },
    el('div', { class: 'spage', 'data-role': 'spage' }, '–'),
    d.hotspots.map(h => el('div', { class: `spot ${h.action}`, style: `left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%` }, el('span', {}, spotLabel(h)))));

  const pagesBody = el('tbody', {}, d.pages.map((p, i) => {
    const f = el('input', { type: 'text', class: 'mono', value: p.showWhen, spellcheck: 'false', autocomplete: 'off', placeholder: '!truck.electric.enabled' });
    f.addEventListener('input', () => { p.showWhen = f.value; touch(); });
    attachSuggest(f, () => { p.showWhen = f.value; touch(); });
    return el('tr', {},
      el('td', {}, el('input', { type: 'text', value: p.name, placeholder: 'page1', onchange: e => { p.name = e.target.value; rebuild(); } })),
      el('td', { class: 'c' }, el('input', { type: 'checkbox', checked: p.rotation, onchange: e => { p.rotation = e.target.checked; touch(); } })),
      el('td', {}, f),
      el('td', {}, el('input', { type: 'number', min: 0, max: 255, class: 'n', value: p.pic ?? '', placeholder: '–', title: t('display.picHint'), onchange: e => { p.pic = numOrNull(e.target.value); touch(); } })),
      el('td', {}, el('input', { type: 'number', min: 0, max: 255, class: 'n', value: p.litPic ?? '', placeholder: '–', title: t('display.picHint'), onchange: e => { p.litPic = numOrNull(e.target.value); touch(); } })),
      el('td', { class: 'c' }, el('button', { class: 'btn ghost icon', 'aria-label': t('common.remove'), onclick: () => { d.pages.splice(i, 1); rebuild(); } }, icon('trash'))));
  }));

  const actions = h => select([['next', t('display.actNext')], ['prev', t('display.actPrev')], ...d.pages.map(p => [`page:${p.name}`, t('display.actGo', { page: p.name })])], h.action, v => { h.action = v; rebuild(); });
  const spotsBody = el('tbody', {}, d.hotspots.map((h, i) => el('tr', {},
    ...['x', 'y', 'w', 'h'].map(k => el('td', {}, el('input', { type: 'number', min: 0, max: 100, value: h[k], class: 'n', onchange: e => { h[k] = Number(e.target.value) || 0; rebuild(); } }))),
    el('td', {}, actions(h)),
    el('td', { class: 'c' }, el('button', { class: 'btn ghost icon', 'aria-label': t('common.remove'), onclick: () => { d.hotspots.splice(i, 1); rebuild(); } }, icon('trash'))))));

  // bindings, filtered by page
  const pageNames = [...new Set([...d.pages.map(p => p.name), ...d.bindings.map(b => b.target.split('.')[0]).filter(Boolean)])];
  const filter = state.nxFilter[d.id] ?? (d.pages.find(p => p.rotation)?.name || pageNames[0] || ''); // start with the first page of the touch rotation
  const chips = el('div', { class: 'chips' },
    [['', t('display.allPages')], ...pageNames.map(n => [n, n])].map(([v, label]) => el('button', {
      class: `chipbtn ${filter === v ? 'on' : ''}`, onclick: () => { state.nxFilter[d.id] = v; renderDisplay(); paint(); },
    }, label, el('span', { class: 'count' }, String(v ? d.bindings.filter(b => b.target.startsWith(`${v}.`)).length + d.widgets.filter(w => w.page === v).length : d.bindings.length + d.widgets.length)))));

  const bindBody = el('tbody', {}, d.bindings.map((b, i) => {
    if (filter && !b.target.startsWith(`${filter}.`)) return null;
    const [pg = '', obj = '', attr = 'txt'] = b.target.split('.');
    const parts = { pg, obj, attr };
    const setTarget = () => { b.target = `${parts.pg}.${parts.obj}.${parts.attr}`; touch(); };
    const other = el('input', { type: 'text', class: 'n', value: PROPS.includes(attr) ? '' : attr, hidden: PROPS.includes(attr), placeholder: 'x', oninput: e => { parts.attr = e.target.value; setTarget(); } });
    const propSel = select([...PROPS.map(p => [p, t(`prop.${p}`)]), ['other', t('prop.other')]], PROPS.includes(attr) ? attr : 'other', v => {
      if (v === 'other') { other.hidden = false; other.focus(); return; }
      other.hidden = true;
      parts.attr = v;
      setTarget();
    });
    const f = el('input', { type: 'text', class: 'mono', value: b.expr, spellcheck: 'false', autocomplete: 'off', 'data-role': 'formula' });
    f.addEventListener('input', () => { b.expr = f.value; touch(); });
    attachSuggest(f, () => { b.expr = f.value; touch(); });
    return el('tr', { 'data-b': i },
      filter ? null : el('td', {}, select(pageNames.map(n => [n, n]), pg, v => { parts.pg = v; setTarget(); })),
      el('td', {}, el('input', { type: 'text', value: obj, class: 'obj', placeholder: 'tgear', oninput: e => { parts.obj = e.target.value; setTarget(); } })),
      el('td', {}, el('div', { class: 'inline' }, propSel, other)),
      el('td', { class: 'f' }, f, el('div', { class: 'err', 'data-role': 'err' })),
      el('td', {}, el('input', { type: 'number', min: 0, max: 6, class: 'n', value: b.decimals ?? '', placeholder: '–', onchange: e => { b.decimals = numOrNull(e.target.value); touch(); } })),
      el('td', { class: 'v', 'data-role': 'val' }, '–'),
      el('td', { class: 'c' }, el('button', { class: 'btn ghost icon', 'aria-label': t('common.remove'), onclick: () => { d.bindings.splice(i, 1); rebuild(); } }, icon('trash'))));
  }));

  // widgets drawn by Studio over the page picture
  const widgetBody = el('tbody', {}, d.widgets.map((w, i) => {
    if (filter && w.page !== filter) return null;
    const f = el('input', { type: 'text', class: 'mono', value: w.expr, spellcheck: 'false', autocomplete: 'off', 'data-role': 'formula' });
    f.addEventListener('input', () => { w.expr = f.value; touch(); });
    attachSuggest(f, () => { w.expr = f.value; touch(); });
    const pos = el('div', { class: 'inline' }, ['x', 'y', 'w', 'h'].map(k => el('input', { type: 'number', min: 0, class: 'n xs', value: w[k], 'aria-label': k, onchange: e => { w[k] = Number(e.target.value) || 0; touch(); } })));
    return el('tr', { 'data-w': i },
      filter ? null : el('td', {}, w.page),
      el('td', {}, el('span', { class: 'mono' }, w.id || '–')),
      el('td', {}, t(`kind.${w.k}`)),
      el('td', {}, pos),
      el('td', { class: 'f' }, f, el('div', { class: 'err', 'data-role': 'err' })),
      el('td', { class: 'v', 'data-role': 'val' }, '–'));
  }));
  const widgetSection = d.widgets.length ? [
    el('h3', {}, t('display.widgets')),
    el('p', { class: 'muted' }, t('display.widgetsLead')),
    d.bindings.length ? null : chips,
    el('div', { class: 'tablewrap' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, filter ? null : el('th', {}, t('display.page')), el('th', {}, 'ID'), el('th', {}, t('display.kind')), el('th', {}, t('display.pos')),
        el('th', {}, t('display.value')), el('th', { class: 'v' }, t('display.now')))),
      widgetBody)),
  ] : [];

  const portCell = el('div', { class: 'inline' });
  const buildPort = () => portCell.replaceChildren(select(portOptions(d.port), d.port, v => { d.port = v; touch(); }),
    el('button', { class: 'btn', onclick: async () => { await loadPorts(); buildPort(); } }, icon('refresh'), t('conn.refresh')));
  buildPort();
  const portField = field(t('display.port'), portCell);
  const baudField = field(t('display.baud'), select(NX_BAUDS.map(b => [b, b]), d.baud, v => { d.baud = Number(v); touch(); }));
  portField.hidden = baudField.hidden = !!d.via;
  const viaSel = select([['', t('display.ownPort')], ...state.config.serial.map(s => [s.id, t('display.through', { name: `${s.name}${s.port ? ` (${s.port})` : ''}` })])], d.via, v => {
    d.via = v;
    portField.hidden = baudField.hidden = !!v;
    touch();
  });

  card.append(
    el('div', { class: 'chead' },
      icon('display'),
      el('input', { type: 'text', class: 'title', value: d.name, 'aria-label': t('display.title'), oninput: e => { d.name = e.target.value; touch(); } }),
      el('span', { class: 'badge', 'data-role': 'badge' }),
      el('span', { class: 'grow' }),
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.enabled, onchange: e => { d.enabled = e.target.checked; rebuild(); } }), el('span', {}, t('display.enabled'))),
      foldBtn),
    el('div', { class: 'scrrow' },
      el('div', { class: 'scrcol' }, screen,
        el('div', { class: 'scrnav' },
          el('button', { class: 'btn', onclick: () => nav('prev') }, icon('left'), t('display.prev')),
          el('button', { class: 'btn', onclick: () => nav('next') }, t('display.next'), icon('right')))),
      el('div', { class: 'scrinfo' },
        el('p', { class: 'big', 'data-role': 'showing' }),
        el('p', { class: 'muted small' }, t('display.previewNote')),
        el('p', { class: 'muted small', 'data-role': 'stats' }),
        el('p', { class: 'err', 'data-role': 'msg' }))),

    ...widgetSection,
    ...(d.bindings.length || !d.widgets.length ? [
    el('h3', {}, t('display.fields')),
    el('p', { class: 'muted' }, t('display.fieldsLead')),
    chips,
    el('div', { class: 'tablewrap' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        filter ? null : el('th', {}, t('display.page')),
        el('th', {}, t('display.object')), el('th', {}, t('display.prop')), el('th', {}, t('display.value')),
        el('th', {}, t('display.decimals')), el('th', { class: 'v' }, t('display.now')), el('th'))),
      bindBody)),
    el('div', { class: 'below' }, el('button', { class: 'btn', onclick: () => {
      d.bindings.push({ target: `${filter || pageNames[0] || 'page1'}..txt`, expr: '', decimals: null });
      rebuild();
    } }, icon('plus'), t('display.addField'))),
    ] : []),

    el('h3', {}, t('display.pages')),
    el('p', { class: 'muted' }, t('display.pagesLead')),
    el('div', { class: 'tablewrap' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', {}, t('display.pageName')), el('th', { class: 'c' }, t('display.inRotation')), el('th', {}, t('display.showWhen')), el('th', {}, t('display.pic')), el('th', {}, t('display.litPic')), el('th'))),
      pagesBody)),
    el('div', { class: 'below' }, el('button', { class: 'btn', onclick: () => { d.pages.push({ name: `page${d.pages.length + 1}`, rotation: true, showWhen: '' }); rebuild(); } }, icon('plus'), t('display.addPage'))),

    el('h3', {}, t('display.spots')),
    el('p', { class: 'muted', 'data-role': 'spotslead' }, t('display.spotsLead', { touch: '–' })),
    el('div', { class: 'tablewrap' }, el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', {}, t('display.spotX')), el('th', {}, t('display.spotY')), el('th', {}, t('display.spotW')), el('th', {}, t('display.spotH')), el('th', {}, t('display.spotAction')), el('th'))),
      spotsBody)),
    el('div', { class: 'below' }, el('button', { class: 'btn', onclick: () => { d.hotspots.push({ x: 0, y: 80, w: 50, h: 20, action: 'next' }); rebuild(); } }, icon('plus'), t('display.addSpot'))),

    el('details', { class: 'adv settings' },
      el('summary', {}, t('display.settings')),
      el('div', { class: 'fields' },
        field(t('display.connection'), viaSel, t('display.throughHint')),
        portField, baudField,
        field(t('display.width'), el('input', { type: 'number', min: 64, value: d.width, class: 'n', onchange: e => { d.width = Number(e.target.value) || d.width; rebuild(); } })),
        field(t('display.height'), el('input', { type: 'number', min: 64, value: d.height, class: 'n', onchange: e => { d.height = Number(e.target.value) || d.height; rebuild(); } })),
        field(t('display.idlePage'), select(pageNames.map(n => [n, n]), d.idlePage, v => { d.idlePage = v; touch(); })),
        field(t('display.encoding'), select([['latin1', t('enc.latin1')], ['latin5', t('enc.latin5')]], d.encoding ?? 'latin1', v => { d.encoding = v; touch(); }))),
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.powerOffWhenIdle, onchange: e => { d.powerOffWhenIdle = e.target.checked; touch(); } }), el('span', {}, t('display.sleep'))),
      el('div', { class: 'below' }, el('button', { class: 'btn danger', onclick: () => {
        if (!confirm(t('display.removeAsk', { name: d.name }))) return;
        state.config.nextion = state.config.nextion.filter(x => x !== d);
        rebuild();
      } }, icon('trash'), t('display.remove')))));
  return card;
}

function paintDisplay() {
  for (const d of state.config.nextion) {
    const card = document.querySelector(`#page-display [data-nx="${d.id}"]`);
    if (!card) continue;
    const st = nxStatusOf(d.id);
    const [cls, label] = stateLabel(st, d.enabled, !!(d.port || d.via));
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    const live = st && st.state === 'open' && d.enabled;
    card.querySelector('[data-role=spage]').textContent = live ? (st.asleep ? t('state.asleep') : st.page || '–') : '–';
    card.querySelector('.screen').classList.toggle('dark', !live || !!st?.asleep);
    card.querySelector('[data-role=showing]').textContent = live && !st.asleep && st.page ? t('display.showing', { page: st.page }) : label;
    card.querySelector('[data-role=stats]').textContent = st ? t('display.stats', { sent: st.sent, resets: st.resets }) : '';
    card.querySelector('[data-role=msg]').textContent = st?.state === 'error' && d.enabled ? st.msg : '';
    card.querySelector('[data-role=spotslead]').textContent = t('display.spotsLead', { touch: st?.touch || '–' });
    card.querySelectorAll('tr[data-w]').forEach(tr => {
      const w = st?.widgets?.[Number(tr.dataset.w)];
      if (!w) return;
      tr.querySelector('[data-role=val]').textContent = w.value === '' ? '–' : w.value;
      tr.querySelector('[data-role=err]').textContent = w.error ?? '';
      tr.querySelector('[data-role=formula]').classList.toggle('bad', !!w.error);
    });
    card.querySelectorAll('tr[data-b]').forEach(tr => {
      const b = st?.bindings?.[Number(tr.dataset.b)];
      if (!b) return;
      tr.querySelector('[data-role=val]').textContent = b.value === '' ? '–' : b.value;
      tr.querySelector('[data-role=err]').textContent = b.error ?? '';
      tr.querySelector('[data-role=formula]').classList.toggle('bad', !!b.error);
    });
  }
}

// --- connections: boards and their ports ----------------------------------------------------------

function portOptions(current) {
  const opts = [['', t('conn.choosePort')]];
  const seen = new Set();
  for (const p of state.ports) {
    seen.add(p.name);
    opts.push([p.name, p.desc ? `${p.name}: ${p.desc}` : p.name]);
  }
  if (current && !seen.has(current)) opts.push([current, t('conn.notPlugged', { port: current })]);
  return opts;
}

function renderConnections() {
  const page = $('#page-connections');
  page.replaceChildren(
    header(t('conn.title'), t('conn.lead')),
    ...state.config.serial.map(connCard),
    el('div', { class: 'below' }, el('button', { class: 'btn primary', onclick: () => {
      state.config.serial.push({
        id: `dev${Date.now() % 100000}`, name: t('conn.newName', { n: state.config.serial.length + 1 }), enabled: false, port: '', baud: 115200, hz: 25,
        separator: ',', terminator: '\\n', idle: 'zeros', channels: [],
      });
      renderConnections();
      paint();
      touch();
    } }, icon('plus'), t('conn.add'))),
    el('div', { class: 'card note' }, icon('display'), el('div', {}, el('h3', {}, t('conn.displays')), el('p', { class: 'muted' }, t('conn.displaysLead')),
      el('button', { class: 'btn', onclick: () => showTab('display') }, t('tab.display')))));
}

function connCard(d) {
  const card = el('div', { class: `card ${d.enabled ? '' : 'dim'}`, 'data-dev': d.id });
  const msg = el('p', { class: 'muted small', 'data-role': 'msg' });
  const portCell = el('div', { class: 'inline' });
  const probe = el('button', { class: 'btn', title: t('conn.identifyHint') }, icon('info'), t('conn.identify'));
  probe.addEventListener('click', async () => {
    if (!d.port) { msg.textContent = t('conn.choosePortFirst'); return; }
    probe.disabled = true;
    msg.className = 'muted small';
    msg.textContent = t('conn.asking', { port: d.port });
    try {
      const r = await api('POST', '/api/probe', { port: d.port, baud: d.baud });
      msg.className = `small ${r.ok ? 'okc' : 'err'}`;
      msg.textContent = r.ok ? t('conn.answered', { port: d.port, reply: r.reply }) : (r.error || r.msg);
    } catch (e) {
      msg.className = 'small err';
      msg.textContent = e.message;
    }
    probe.disabled = false;
  });
  const buildPort = () => portCell.replaceChildren(select(portOptions(d.port), d.port, v => { d.port = v; touch(); }),
    el('button', { class: 'btn', onclick: async () => { await loadPorts(); buildPort(); } }, icon('refresh'), t('conn.refresh')), probe);
  buildPort();

  card.append(
    el('div', { class: 'chead' },
      icon('cpu'),
      el('input', { type: 'text', class: 'title', value: d.name, 'aria-label': t('conn.title'), oninput: e => { d.name = e.target.value; touch(); } }),
      el('span', { class: 'badge', 'data-role': 'badge' }),
      d.board ? el('span', { class: 'dmotor' }, t('board.octopus')) : null,
      el('span', { class: 'grow' }),
      el('label', { class: 'switch' }, el('input', { type: 'checkbox', checked: d.enabled, onchange: e => { d.enabled = e.target.checked; renderConnections(); paint(); touch(); } }), el('span', {}, t('conn.enabled')))),
    el('div', { class: 'fields' },
      field(t('conn.port'), portCell),
      field(t('conn.idle'), select([['zeros', t('conn.idleZeros')], ['hold', t('conn.idleHold')], ['none', t('conn.idleNone')]], d.idle, v => { d.idle = v; touch(); }))),
    msg,
    el('details', { class: 'adv' },
      el('summary', {}, t('gauge.advanced')),
      el('div', { class: 'fields' },
        field(t('conn.baud'), select(BAUDS.map(b => [b, b]), d.baud, v => { d.baud = Number(v); touch(); })),
        field(t('conn.rate'), el('input', { type: 'number', min: 1, max: 25, value: d.hz, class: 'n', onchange: e => { d.hz = Number(e.target.value) || 25; touch(); } })),
        d.board ? null : field(t('conn.separator'), el('input', { type: 'text', maxlength: 4, value: d.separator, class: 'n', oninput: e => { d.separator = e.target.value; touch(); } })),
        d.board ? null : field(t('conn.lineEnd'), select(LINE_ENDS, d.terminator, v => { d.terminator = v; touch(); }))),
      el('p', { class: 'mono small', 'data-role': 'line' })),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => { state.open = null; showTab('cockpit'); } }, icon('gauge'), t('conn.editGauges'), el('span', { class: 'count' }, String(d.channels.length))),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn danger', onclick: () => {
        if (!confirm(t('conn.removeAsk', { name: d.name }))) return;
        state.config.serial = state.config.serial.filter(x => x !== d);
        renderConnections();
        paint();
        touch();
      } }, icon('trash'), t('conn.remove'))));
  return card;
}

function paintConnections() {
  for (const d of state.config.serial) {
    const card = document.querySelector(`#page-connections [data-dev="${d.id}"]`);
    if (!card) continue;
    const st = statusOf(d.id);
    const [cls, label] = stateLabel(st, d.enabled, !!d.port);
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    const msg = card.querySelector('[data-role=msg]');
    if (st?.state === 'error' && d.enabled && st.msg && !msg.textContent) { msg.className = 'small err'; msg.textContent = st.msg; }
    const line = st ? JSON.stringify(st.line ?? '').slice(1, -1) : '';
    card.querySelector('[data-role=line]').textContent =
      `${t('conn.line', { line: line || '–' })}   ${t('conn.sent', { n: st?.sent ?? 0 })}${st?.rx ? `   ${t('conn.says', { rx: st.rx.trim() })}` : ''}`;
  }
}

// --- game data ------------------------------------------------------------------------------------

const GROUPS = ['x', 'truck', 'trailer', 'job', 'navigation', 'controls', 'game'];
let dataSearch = '';

function renderData() {
  const page = $('#page-data');
  const search = el('input', { type: 'search', class: 'search', value: dataSearch, placeholder: t('data.search'), autocomplete: 'off' });
  const list = el('div', { class: 'datalist' });
  const count = el('p', { class: 'muted small' });
  const build = () => {
    const words = dataSearch.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = c => { const g = GROUPS.indexOf(c.path.split('.')[0]); return g < 0 ? GROUPS.length : g; };
    const hits = state.catalog.filter(c => words.every(w => c.path.toLowerCase().includes(w) || (c.info || '').toLowerCase().includes(w)))
      .sort((a, b) => rank(a) - rank(b)); // ready-made values first, then truck, trailer…
    const shown = hits.slice(0, 200);
    state.visible = shown.map(c => c.path);
    count.textContent = hits.length > shown.length ? t('data.more', { shown: shown.length, all: hits.length }) : t('data.count', { n: hits.length });
    const byGroup = new Map();
    for (const c of shown) {
      const g = GROUPS.includes(c.path.split('.')[0]) ? c.path.split('.')[0] : 'other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(c);
    }
    list.replaceChildren(...[...GROUPS, 'other'].filter(g => byGroup.has(g)).map(g => el('div', { class: 'card group' },
      el('h3', {}, t(`group.${g}`), el('span', { class: 'count' }, String(byGroup.get(g).length))),
      byGroup.get(g).map(c => el('button', {
        class: 'prop', 'data-path': c.path,
        onclick: () => { navigator.clipboard?.writeText(c.path).then(() => toast(t('data.copied', { path: c.path })), () => {}); },
      }, el('span', { class: 'pname' }, el('span', { class: 'mono' }, c.path), c.info ? el('span', { class: 'pinfo' }, c.info) : null),
      el('span', { class: 'pval off' }, '–'))))));
    sendWatch();
    paintData();
  };
  search.addEventListener('input', () => { dataSearch = search.value; build(); });
  page.replaceChildren(header(t('data.title'), t('data.lead')), search, count, list,
    el('details', { class: 'adv' }, el('summary', {}, t('help.formula')), el('p', { class: 'muted' }, t('help.body'))));
  build();
}

function fmtValue(v) {
  if (v == null) return '–';
  if (typeof v === 'boolean') return v ? t('common.yes') : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v);
}

function paintData() {
  for (const row of document.querySelectorAll('#page-data .prop')) {
    const v = state.values[row.dataset.path];
    const cell = row.querySelector('.pval');
    cell.textContent = fmtValue(v);
    cell.classList.toggle('off', v == null);
  }
}

const toast = text => {
  const n = el('div', { class: 'toast' }, text);
  document.body.append(n);
  setTimeout(() => n.remove(), 1400);
};

// --- formula suggestions --------------------------------------------------------------------------

const box = $('#suggest');
let sugTarget = null, sugItems = [], sugIndex = 0, sugApply = null;

function attachSuggest(input, onApply) {
  input.addEventListener('input', () => showSuggest(input, onApply));
  input.addEventListener('blur', () => setTimeout(hideSuggest, 120));
  input.addEventListener('keydown', e => {
    if (box.hidden || sugTarget !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : sugItems.length - 1)) % sugItems.length;
      paintSuggest();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptSuggest(sugItems[sugIndex]);
    } else if (e.key === 'Escape') hideSuggest();
  });
}

function showSuggest(input, onApply) {
  const caret = input.selectionStart ?? input.value.length;
  const token = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(input.value.slice(0, caret))?.[0] ?? '';
  if (token.length < 2) return hideSuggest();
  const low = token.toLowerCase();
  const hits = state.catalog.filter(c => c.path.toLowerCase().includes(low));
  hits.sort((a, b) => (b.path.toLowerCase().startsWith(low) - a.path.toLowerCase().startsWith(low)) || a.path.length - b.path.length);
  sugItems = hits.slice(0, 10).map(c => c.path);
  if (!sugItems.length || (sugItems.length === 1 && sugItems[0] === token)) return hideSuggest();
  sugTarget = input; sugIndex = 0; sugApply = onApply;
  const r = input.getBoundingClientRect();
  box.style.left = `${r.left + window.scrollX}px`;
  box.style.top = `${r.bottom + window.scrollY + 2}px`;
  box.hidden = false;
  paintSuggest();
}

function paintSuggest() {
  box.replaceChildren(...sugItems.map((p, i) => {
    const d = el('div', { class: i === sugIndex ? 'on' : '' }, p);
    d.addEventListener('mousedown', e => { e.preventDefault(); acceptSuggest(p); });
    return d;
  }));
}

function acceptSuggest(path) {
  const input = sugTarget;
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret).replace(/[A-Za-z_][A-Za-z0-9_.]*$/, '');
  input.value = before + path + input.value.slice(caret);
  const pos = (before + path).length;
  input.setSelectionRange(pos, pos);
  hideSuggest();
  sugApply?.();
  input.focus();
}

function hideSuggest() {
  box.hidden = true;
  sugTarget = null;
}

// --- start --------------------------------------------------------------------------------------

async function loadPorts() {
  try {
    const r = await api('GET', '/api/ports');
    state.ports = r.ports ?? [];
  } catch {
    state.ports = [];
  }
}

(async function init() {
  setLang(LANG);
  [state.catalog, state.config] = await Promise.all([api('GET', '/api/catalog'), api('GET', '/api/config')]);
  state.config.nextion ??= [];
  await loadPorts();
  const wanted = location.hash.slice(1);
  state.tab = TABS.some(([n]) => n === wanted) ? wanted : 'cockpit';
  renderLang();
  showTab(state.tab);
  connectLive();
})();
