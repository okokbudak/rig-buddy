'use strict';
// Rig Buddy Studio page. No framework: a few render functions and one WebSocket for live values.

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
};

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

const state = { catalog: [], config: { serial: [], nextion: [] }, ports: [], status: null, values: {}, tab: 'serial', visible: [] };
const LINE_ENDS = [['\\n', 'LF (\\n)'], ['\\r\\n', 'CR+LF'], ['\\r', 'CR'], ['', 'none']];
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 500000, 1000000];
const IDLE = [['zeros', 'send zeros'], ['hold', 'keep the last values'], ['none', 'send nothing']];

// --- live socket ------------------------------------------------------------------------------

let ws = null;
function connectLive() {
  ws = new WebSocket(`ws://${location.host}/live`);
  ws.onopen = sendWatch;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    state.status = m.status;
    state.values = m.values;
    paintLive();
  };
  ws.onclose = () => {
    state.status = null;
    paintChips();
    setTimeout(connectLive, 1500);
  };
}
function sendWatch() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ watch: state.tab === 'live' ? state.visible : [] }));
}

// --- tabs ---------------------------------------------------------------------------------------

function showTab(name) {
  state.tab = name;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === name);
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `page-${name}`;
  history.replaceState(null, '', `#${name}`);
  if (name === 'live') renderLive();
  sendWatch();
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));

// --- formatting ---------------------------------------------------------------------------------

function fmt(v) {
  if (v == null) return '–';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v);
}

// --- live data page ---------------------------------------------------------------------------

const toast = text => {
  const t = el('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1400);
};

function renderLive() {
  const words = $('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = state.catalog.filter(c => words.every(w => c.path.toLowerCase().includes(w) || (c.info || '').toLowerCase().includes(w)));
  const shown = hits.slice(0, 150);
  state.visible = shown.map(c => c.path);
  $('#liveCount').textContent = hits.length > shown.length ? `${shown.length} of ${hits.length} shown: type more to narrow down` : `${hits.length} properties`;
  const list = $('#liveList');
  list.replaceChildren(...shown.map(c => el('div', {
    class: 'prop', 'data-path': c.path, title: 'Click to copy',
    onclick: () => { navigator.clipboard?.writeText(c.path).then(() => toast(`Copied ${c.path}`), () => {}); },
  },
  el('div', {}, el('div', { class: 'name' }, c.path), c.info ? el('div', { class: 'info' }, c.info) : null),
  el('div', { class: 'val off' }, '–'))));
  sendWatch();
}
$('#search').addEventListener('input', renderLive);

function paintLive() {
  paintChips();
  if (state.tab === 'live') {
    for (const row of $('#liveList').children) {
      const v = state.values[row.dataset.path];
      const cell = row.lastChild;
      cell.textContent = fmt(v);
      cell.classList.toggle('off', v == null);
    }
  }
  paintDevices();
  paintNextion();
}

function paintChips() {
  const s = state.status;
  const game = $('#chipGame'), hub = $('#chipHub');
  game.className = `chip ${s?.game ? 'ok' : ''}`;
  game.lastChild.textContent = s ? (s.game ? 'Game running' : 'Game not running') : 'Agent not reachable';
  hub.className = `chip ${s?.hub ? 'ok' : ''}`;
  hub.lastChild.textContent = s ? (s.hub ? 'Serial ports ready' : 'Serial ports: RigBuddy.exe not reachable') : 'Serial ports';
}

// --- serial devices -----------------------------------------------------------------------------

let saveTimer = null;
function touch() {
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await api('PUT', '/api/config', state.config);
      $('#saveState').textContent = 'All changes saved';
    } catch (e) {
      $('#saveState').textContent = `Could not save: ${e.message}`;
    }
  }, 500);
}

function numOrNull(v) {
  return v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

function select(options, value, onchange) {
  const s = el('select', { onchange: () => onchange(s.value) },
    options.map(([v, label]) => el('option', { value: v, selected: String(v) === String(value) }, label)));
  return s;
}

function portOptions(current) {
  const opts = [['', '— choose a port —']];
  const seen = new Set();
  for (const p of state.ports) {
    seen.add(p.name);
    opts.push([p.name, p.desc ? `${p.name}: ${p.desc}` : p.name]);
  }
  if (current && !seen.has(current)) opts.push([current, `${current} (not plugged in)`]);
  return opts;
}

function deviceCard(d) {
  const card = el('div', { class: 'device', 'data-dev': d.id });
  const msg = el('div', { class: 'msg', 'data-role': 'msg' });
  const portCell = el('div');
  const buildPort = () => {
    const sel = select(portOptions(d.port), d.port, v => { d.port = v; touch(); });
    portCell.replaceChildren(sel);
  };
  buildPort();

  const name = el('input', { type: 'text', class: 'name', value: d.name, 'aria-label': 'Device name', oninput: () => { d.name = name.value; touch(); } });
  const enabled = el('input', { type: 'checkbox', checked: d.enabled, onchange: () => { d.enabled = enabled.checked; touch(); } });

  const probeBtn = el('button', { class: 'btn small', title: 'Opens the port, asks "?" and shows the answer (the cluster sketches reply CLUSTER1 / CLUSTER2)' }, 'Identify');
  probeBtn.addEventListener('click', async () => {
    if (!d.port) { msg.textContent = 'Choose a port first.'; return; }
    probeBtn.disabled = true;
    msg.style.color = 'var(--muted)';
    msg.textContent = `Asking ${d.port}… (about 3 s)`;
    try {
      const r = await api('POST', '/api/probe', { port: d.port, baud: d.baud });
      msg.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
      msg.textContent = r.ok ? `${d.port} answered: ${r.reply}` : (r.error || r.msg);
    } catch (e) {
      msg.style.color = 'var(--bad)';
      msg.textContent = e.message;
    }
    probeBtn.disabled = false;
  });
  const refresh = el('button', { class: 'btn small', onclick: async () => { await loadPorts(); buildPort(); } }, 'Refresh');

  card.append(
    el('div', { class: 'dhead' },
      name,
      el('label', { class: 'switch' }, enabled, 'Enabled'),
      el('span', { class: 'badge', 'data-role': 'badge' }, 'Off'),
      el('div', { class: 'spacer', style: 'flex:1' }),
      el('button', { class: 'btn small danger', onclick: () => {
        if (!confirm(`Remove "${d.name}"?`)) return;
        state.config.serial = state.config.serial.filter(x => x !== d);
        renderDevices();
        touch();
      } }, 'Remove')),
    el('div', { class: 'fields' },
      el('label', {}, 'Port', el('div', { style: 'display:flex;gap:6px;align-items:center' }, portCell, refresh, probeBtn)),
      el('label', {}, 'Baud rate', select(BAUDS.map(b => [b, b]), d.baud, v => { d.baud = Number(v); touch(); })),
      el('label', {}, 'Rate (per second)', el('input', { type: 'number', min: 1, max: 25, value: d.hz, oninput: e => { d.hz = Number(e.target.value) || 25; touch(); } })),
      el('label', {}, 'Separator', el('input', { type: 'text', class: 'sep', maxlength: 4, value: d.separator, oninput: e => { d.separator = e.target.value; touch(); } })),
      el('label', {}, 'Line end', select(LINE_ENDS, d.terminator, v => { d.terminator = v; touch(); })),
      el('label', {}, 'When the game is closed', select(IDLE, d.idle, v => { d.idle = v; touch(); }))),
    msg,
    channelsTable(d),
    el('div', { class: 'line', 'data-role': 'line' }));
  return card;
}

function channelsTable(d) {
  const tbody = el('tbody');
  const build = () => {
    tbody.replaceChildren(...d.channels.map((c, i) => {
      const formula = el('input', { type: 'text', value: c.expr, spellcheck: 'false', autocomplete: 'off', placeholder: 'e.g. truck.speed.kph * 10', 'data-role': 'formula' });
      formula.addEventListener('input', () => { c.expr = formula.value; touch(); });
      attachSuggest(formula, () => { c.expr = formula.value; touch(); });
      return el('tr', { 'data-ch': i },
        el('td', {}, el('input', { type: 'text', value: c.name, placeholder: `Channel ${i + 1}`, oninput: e => { c.name = e.target.value; touch(); } })),
        el('td', { class: 'f' }, formula, el('div', { class: 'err', 'data-role': 'err' })),
        el('td', { class: 'mm' }, el('input', { type: 'number', value: c.min ?? '', placeholder: 'min', oninput: e => { c.min = numOrNull(e.target.value); touch(); } })),
        el('td', { class: 'mm' }, el('input', { type: 'number', value: c.max ?? '', placeholder: 'max', oninput: e => { c.max = numOrNull(e.target.value); touch(); } })),
        el('td', { class: 'v', 'data-role': 'val' }, '–'),
        el('td', {}, el('button', { class: 'btn small', title: 'Remove channel', 'aria-label': 'Remove channel', onclick: () => { d.channels.splice(i, 1); build(); touch(); } }, '✕')));
    }));
  };
  build();
  return el('div', {},
    el('table', { class: 'ch' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Formula'), el('th', {}, 'Min'), el('th', {}, 'Max'), el('th', { style: 'text-align:right' }, 'Value'), el('th'))),
      tbody),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small', onclick: () => { d.channels.push({ name: '', expr: '', min: null, max: null }); build(); touch(); } }, 'Add channel')));
}

function renderDevices() {
  $('#devices').replaceChildren(...state.config.serial.map(deviceCard));
  paintDevices();
}

function paintDevices() {
  const devs = state.status?.devices;
  if (!devs) return;
  for (const d of state.config.serial) {
    const card = document.querySelector(`[data-dev="${d.id}"]`);
    const st = devs.find(x => x.id === d.id);
    if (!card || !st) continue;
    card.classList.toggle('off', !d.enabled);
    let label = 'Off', cls = '';
    if (d.enabled && !d.port) label = 'Choose a port';
    else if (d.enabled) {
      cls = st.state;
      label = { open: 'Connected', connecting: 'Connecting…', error: 'Problem', off: 'Starting…' }[st.state] ?? st.state;
    }
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    const msg = card.querySelector('[data-role=msg]');
    if (st.state === 'error' && d.enabled && st.msg && !msg.dataset.probe) {
      msg.style.color = 'var(--bad)';
      msg.textContent = st.msg;
    } else if (st.state === 'open' && msg.style.color === 'var(--bad)') msg.textContent = '';
    const line = card.querySelector('[data-role=line]');
    line.replaceChildren(
      document.createTextNode('Line: '), el('b', {}, JSON.stringify(st.line).slice(1, -1) || '–'),
      document.createTextNode(`   sent: ${st.sent}${st.rx ? `   device says: ${st.rx}` : ''}`));
    card.querySelectorAll('tr[data-ch]').forEach(tr => {
      const i = Number(tr.dataset.ch);
      tr.querySelector('[data-role=val]').textContent = st.values[i] ?? '–';
      const err = st.errors[i];
      tr.querySelector('[data-role=err]').textContent = err ?? '';
      tr.querySelector('[data-role=formula]').classList.toggle('bad', !!err);
    });
  }
}

$('#addDevice').addEventListener('click', () => {
  state.config.serial.push({
    id: `dev${Date.now() % 100000}`, name: `Device ${state.config.serial.length + 1}`, enabled: false, port: '', baud: 115200, hz: 25,
    separator: ',', terminator: '\\n', idle: 'zeros', channels: [{ name: '', expr: '', min: null, max: null }],
  });
  renderDevices();
  touch();
});

// --- Nextion displays -----------------------------------------------------------------------------

const NX_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 512000, 921600];
const nxFilter = {}; // device id -> page filter of the bindings table

function nextionCard(d) {
  const card = el('div', { class: 'device', 'data-nx': d.id });
  const name = el('input', { type: 'text', class: 'name', value: d.name, 'aria-label': 'Display name', oninput: () => { d.name = name.value; touch(); } });
  const enabled = el('input', { type: 'checkbox', checked: d.enabled, onchange: () => { d.enabled = enabled.checked; touch(); } });
  const portCell = el('div');
  const buildPort = () => portCell.replaceChildren(select(portOptions(d.port), d.port, v => { d.port = v; touch(); }));
  buildPort();
  const num = (key, w) => el('input', { type: 'number', min: 1, value: d[key], style: `width:${w}px`, oninput: e => { d[key] = Number(e.target.value) || d[key]; touch(); } });

  const pagesBody = el('tbody');
  const buildPages = () => {
    pagesBody.replaceChildren(...d.pages.map((p, i) => {
      const f = el('input', { type: 'text', value: p.showWhen, spellcheck: 'false', autocomplete: 'off', placeholder: 'e.g. !truck.electric.enabled', 'data-role': 'formula' });
      f.addEventListener('input', () => { p.showWhen = f.value; touch(); });
      attachSuggest(f, () => { p.showWhen = f.value; touch(); });
      return el('tr', {},
        el('td', {}, el('input', { type: 'text', value: p.name, placeholder: 'page1', oninput: e => { p.name = e.target.value; touch(); } })),
        el('td', { style: 'text-align:center' }, el('input', { type: 'checkbox', checked: p.rotation, onchange: e => { p.rotation = e.target.checked; touch(); } })),
        el('td', { class: 'f' }, f),
        el('td', {}, el('button', { class: 'btn small', 'aria-label': 'Remove page', onclick: () => { d.pages.splice(i, 1); buildPages(); buildSpots(); touch(); } }, '✕')));
    }));
  };

  const spotAction = h => select([['next', 'Next page'], ['prev', 'Previous page'], ...d.pages.map(p => [`page:${p.name}`, `Go to ${p.name}`])], h.action, v => { h.action = v; touch(); });
  const spotsBody = el('tbody');
  const buildSpots = () => {
    spotsBody.replaceChildren(...d.hotspots.map((h, i) => el('tr', {},
      ...['x', 'y', 'w', 'h'].map(k => el('td', { class: 'mm' }, el('input', { type: 'number', min: 0, max: 100, value: h[k], oninput: e => { h[k] = Number(e.target.value) || 0; touch(); } }))),
      el('td', {}, spotAction(h)),
      el('td', {}, el('button', { class: 'btn small', 'aria-label': 'Remove hotspot', onclick: () => { d.hotspots.splice(i, 1); buildSpots(); touch(); } }, '✕')))));
  };
  buildPages();
  buildSpots();

  const bindBody = el('tbody');
  const filterSel = el('select');
  const buildFilter = () => {
    const pages = [...new Set(d.bindings.map(b => b.target.split('.')[0]).filter(Boolean))];
    filterSel.replaceChildren(el('option', { value: '' }, `All pages (${d.bindings.length})`), ...pages.map(p => el('option', { value: p, selected: nxFilter[d.id] === p }, p)));
  };
  filterSel.addEventListener('change', () => { nxFilter[d.id] = filterSel.value; buildBindings(); });
  const buildBindings = () => {
    const want = nxFilter[d.id] || '';
    bindBody.replaceChildren(...d.bindings.map((b, i) => {
      if (want && !b.target.startsWith(`${want}.`)) return null;
      const f = el('input', { type: 'text', value: b.expr, spellcheck: 'false', autocomplete: 'off', 'data-role': 'formula' });
      f.addEventListener('input', () => { b.expr = f.value; touch(); });
      attachSuggest(f, () => { b.expr = f.value; touch(); });
      return el('tr', { 'data-b': i },
        el('td', {}, el('input', { type: 'text', value: b.target, spellcheck: 'false', placeholder: 'page1.tgear.txt', oninput: e => { b.target = e.target.value; touch(); } })),
        el('td', { class: 'f' }, f, el('div', { class: 'err', 'data-role': 'err' })),
        el('td', { class: 'mm' }, el('input', { type: 'number', min: 0, max: 6, value: b.decimals ?? '', placeholder: 'auto', oninput: e => { b.decimals = numOrNull(e.target.value); touch(); } })),
        el('td', { class: 'v', 'data-role': 'val' }, '–'),
        el('td', {}, el('button', { class: 'btn small', 'aria-label': 'Remove binding', onclick: () => { d.bindings.splice(i, 1); buildBindings(); buildFilter(); touch(); } }, '✕')));
    }));
  };
  buildFilter();
  buildBindings();

  const nav = action => api('POST', '/api/nextion/nav', { id: d.id, action }).catch(() => {});
  card.append(
    el('div', { class: 'dhead' },
      name,
      el('label', { class: 'switch' }, enabled, 'Enabled'),
      el('span', { class: 'badge', 'data-role': 'badge' }, 'Off'),
      el('span', { class: 'muted', 'data-role': 'page' }),
      el('div', { style: 'flex:1' }),
      el('button', { class: 'btn small', onclick: () => nav('prev') }, '‹ Previous page'),
      el('button', { class: 'btn small', onclick: () => nav('next') }, 'Next page ›'),
      el('button', { class: 'btn small danger', onclick: () => {
        if (!confirm(`Remove "${d.name}"?`)) return;
        state.config.nextion = state.config.nextion.filter(x => x !== d);
        renderNextion();
        touch();
      } }, 'Remove')),
    el('div', { class: 'fields' },
      el('label', {}, 'Port', el('div', { style: 'display:flex;gap:6px;align-items:center' }, portCell, el('button', { class: 'btn small', onclick: async () => { await loadPorts(); buildPort(); } }, 'Refresh'))),
      el('label', {}, 'Baud rate', select(NX_BAUDS.map(b => [b, b]), d.baud, v => { d.baud = Number(v); touch(); })),
      el('label', {}, 'Screen width (px)', num('width', 80)),
      el('label', {}, 'Screen height (px)', num('height', 80)),
      el('label', {}, 'Page while no game runs', el('input', { type: 'text', value: d.idlePage, placeholder: 'page1', style: 'width:110px', oninput: e => { d.idlePage = e.target.value; touch(); } })),
      el('label', { class: 'switch', style: 'flex-direction:row;color:var(--text);font-size:14px' },
        el('input', { type: 'checkbox', checked: d.powerOffWhenIdle, onchange: e => { d.powerOffWhenIdle = e.target.checked; touch(); } }), 'Put the display to sleep when no game runs')),
    el('div', { class: 'msg', 'data-role': 'msg' }),
    el('h3', {}, 'Pages'),
    el('p', { class: 'muted' }, 'Pages in rotation are what the touch hotspots cycle through. A "show when" formula pops that page up while it is true (for example the dark page with the ignition off).'),
    el('table', { class: 'ch' }, el('thead', {}, el('tr', {}, el('th', {}, 'Page'), el('th', { style: 'text-align:center' }, 'In rotation'), el('th', {}, 'Show when'), el('th'))), pagesBody),
    el('div', { class: 'row-actions' }, el('button', { class: 'btn small', onclick: () => { d.pages.push({ name: '', rotation: true, showWhen: '' }); buildPages(); touch(); } }, 'Add page')),
    el('h3', {}, 'Touch hotspots'),
    el('p', { class: 'muted' }, 'Rectangles in % of the screen (from the top left). A tap inside one runs its action. Last touch: ', el('span', { 'data-role': 'touch' }, '–')),
    el('table', { class: 'ch' }, el('thead', {}, el('tr', {}, el('th', {}, 'X %'), el('th', {}, 'Y %'), el('th', {}, 'Width %'), el('th', {}, 'Height %'), el('th', {}, 'Action'), el('th'))), spotsBody),
    el('div', { class: 'row-actions' }, el('button', { class: 'btn small', onclick: () => { d.hotspots.push({ x: 0, y: 80, w: 50, h: 20, action: 'next' }); buildSpots(); touch(); } }, 'Add hotspot')),
    el('h3', {}, 'Bindings'),
    el('p', { class: 'muted' }, 'Target is page.object.attribute as named in the Nextion editor: ', el('code', {}, '.txt'), ' sets text, ', el('code', {}, '.vis'), ' shows/hides (yes/no formula), anything else (', el('code', {}, '.val'), ', ', el('code', {}, '.pic'), ', ', el('code', {}, '.pco'), '…) takes a whole number. Only the bindings of the page on screen are sent, and only when the value changes.'),
    el('div', { class: 'row-actions', style: 'margin:0 0 8px' }, filterSel),
    el('table', { class: 'ch' }, el('thead', {}, el('tr', {}, el('th', {}, 'Target'), el('th', {}, 'Formula'), el('th', {}, 'Decimals'), el('th', { style: 'text-align:right' }, 'Sent'), el('th'))), bindBody),
    el('div', { class: 'row-actions' }, el('button', { class: 'btn small', onclick: () => { d.bindings.push({ target: '', expr: '', decimals: null }); buildBindings(); buildFilter(); touch(); } }, 'Add binding')),
    el('div', { class: 'line', 'data-role': 'line' }));
  return card;
}

function renderNextion() {
  $('#nextions').replaceChildren(...state.config.nextion.map(nextionCard));
  paintNextion();
}

function paintNextion() {
  const list = state.status?.nextion;
  if (!list) return;
  for (const d of state.config.nextion) {
    const card = document.querySelector(`[data-nx="${d.id}"]`);
    const st = list.find(x => x.id === d.id);
    if (!card || !st) continue;
    card.classList.toggle('off', !d.enabled);
    let label = 'Off', cls = '';
    if (d.enabled && !d.port) label = 'Choose a port';
    else if (d.enabled) {
      cls = st.state;
      label = st.asleep ? 'Asleep' : { open: 'Connected', connecting: 'Connecting…', error: 'Problem', off: 'Starting…' }[st.state] ?? st.state;
    }
    const badge = card.querySelector('[data-role=badge]');
    badge.textContent = label;
    badge.className = `badge ${cls}`;
    card.querySelector('[data-role=page]').textContent = st.page ? `showing ${st.page}` : '';
    const msg = card.querySelector('[data-role=msg]');
    msg.style.color = 'var(--bad)';
    msg.textContent = st.state === 'error' && d.enabled ? st.msg : '';
    card.querySelector('[data-role=touch]').textContent = st.touch || '–';
    card.querySelector('[data-role=line]').textContent = `commands sent: ${st.sent}   display restarts seen: ${st.resets}`;
    card.querySelectorAll('tr[data-b]').forEach(tr => {
      const b = st.bindings[Number(tr.dataset.b)];
      if (!b) return;
      tr.querySelector('[data-role=val]').textContent = b.value === '' ? '–' : b.value;
      tr.querySelector('[data-role=err]').textContent = b.error ?? '';
      tr.querySelector('[data-role=formula]').classList.toggle('bad', !!b.error);
    });
  }
}

$('#addNextion').addEventListener('click', () => {
  state.config.nextion.push({
    id: `nx${Date.now() % 100000}`, name: `Display ${state.config.nextion.length + 1}`, enabled: false, port: '', baud: 115200, width: 480, height: 272,
    powerOffWhenIdle: false, idlePage: 'page0', pages: [{ name: 'page1', rotation: true, showWhen: '' }], hotspots: [], bindings: [],
  });
  renderNextion();
  touch();
});

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
  const t = token.toLowerCase();
  const hits = state.catalog.filter(c => c.path.toLowerCase().includes(t));
  hits.sort((a, b) => (b.path.toLowerCase().startsWith(t) - a.path.toLowerCase().startsWith(t)) || a.path.length - b.path.length);
  sugItems = hits.slice(0, 10).map(c => c.path);
  if (!sugItems.length || (sugItems.length === 1 && sugItems[0] === token)) return hideSuggest();
  sugTarget = input; sugIndex = 0; sugApply = onApply;
  const r = input.getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.top = `${r.bottom + 2}px`;
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
  [state.catalog, state.config] = await Promise.all([api('GET', '/api/catalog'), api('GET', '/api/config')]);
  await loadPorts();
  state.config.nextion ??= [];
  renderDevices();
  renderNextion();
  connectLive();
  const wanted = location.hash.slice(1);
  showTab(['live', 'serial', 'nextion'].includes(wanted) ? wanted : 'serial');
})();
