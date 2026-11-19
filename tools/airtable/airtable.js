// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { parseSettings, parseSources, loadSiteConfig } from './lib/config.js';
import {
  tokenConnection, workerConnection, demoConnection, savedToken, saveToken, TOKEN_PATTERN,
} from './lib/connection.js';
import {
  FORMATS, buildContent, imagesIn, suggestFormat,
} from './lib/format.js';
import { copyImages } from './lib/images.js';
import { orderFields, defaultFields, searchRecords } from './lib/fields.js';
import createPanel from './panel.js';

const params = new URLSearchParams(window.location.search);
const SDK_TIMEOUT = 4000;
const LAST_KEY = 'ew-airtable:last';

const state = {
  mode: 'loading',
  sdk: null,
  context: null,
  ims: '',
  settings: parseSettings(null, window.location.search),
  sources: [],
  conn: null,
  view: 'loading',
  connectError: '',
  bases: [],
  tables: [],
  source: null,
  table: null,
  records: [],
  more: false,
  query: '',
  selected: new Set(),
  fields: [],
  fieldsTouched: false,
  format: 'table',
  options: { header: true, labels: true, block: '' },
  live: { blockIndex: null, editable: true },
  busy: '',
  error: null,
};

let panel;
let loadSeq = 0;

function remember() {
  try {
    const { source } = state;
    if (!source) return;
    const key = `${LAST_KEY}:${state.context?.org}/${state.context?.repo}`;
    localStorage.setItem(key, JSON.stringify({
      title: source.title || '', base: source.base, table: source.table, view: source.view || '',
    }));
  } catch {
    // Not important.
  }
}

function recalled() {
  try {
    return JSON.parse(localStorage.getItem(`${LAST_KEY}:${state.context?.org}/${state.context?.repo}`) || 'null');
  } catch {
    return null;
  }
}

function fail(error) {
  state.error = error;
  state.busy = '';
  panel.render();
}

function recordOptions() {
  return {
    view: state.source?.view || '',
    locale: state.settings.locale,
    timeZone: state.settings['time-zone'] || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    max: state.settings['max-records'],
  };
}

function applyDefaults() {
  const { table, source } = state;
  if (!table) return;
  if (!state.fieldsTouched) {
    state.fields = source?.fields?.length && source.format === state.format
      ? orderFields(table, source.fields)
      : defaultFields(table, state.format);
  }
}

async function loadRecords(fresh = false) {
  const { source } = state;
  if (!source?.base || !source.table) return;
  loadSeq += 1;
  const seq = loadSeq;
  state.busy = 'Loading records…';
  state.error = null;
  panel.render();
  try {
    if (!state.tables.length || state.tables.base !== source.base || fresh) {
      const tables = await state.conn.tables(source.base, fresh);
      tables.base = source.base;
      state.tables = tables;
    }
    const table = state.tables.find((t) => t.id === source.table || t.name === source.table);
    if (!table) throw new Error(`There is no table called “${source.table}” in this base any more.`);
    const opts = recordOptions();
    const { records, more } = await state.conn.records(source.base, table.id, opts, fresh);
    if (seq !== loadSeq) return;
    const changedTable = state.table?.id !== table.id;
    state.table = table;
    state.records = records;
    state.more = more;
    if (changedTable) {
      state.format = source.format || suggestFormat(table);
      state.options = {
        header: source.header ?? true,
        labels: source.labels ?? true,
        block: source.block || '',
      };
      state.fieldsTouched = false;
      state.query = '';
      state.selected = new Set(records.map((r) => r.id));
      applyDefaults();
    } else {
      const ids = new Set(records.map((r) => r.id));
      state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
    }
    state.busy = '';
    remember();
    panel.render();
  } catch (error) {
    if (seq === loadSeq) fail(error);
  }
}

async function loadBases(fresh = false) {
  if (state.settings['allow-browse'] === 'no' && state.sources.length) return;
  try {
    state.bases = await state.conn.bases(fresh);
  } catch (error) {
    state.bases = [];
    if (!state.sources.length) throw error;
  }
}

function pickStart() {
  const last = recalled();
  const match = last && state.sources.find((s) => s.title === last.title);
  if (match) return match;
  if (last?.base && state.bases.some((b) => b.id === last.base)) return { ...last, title: '' };
  if (state.sources[0]) return state.sources[0];
  if (state.bases[0]) {
    return {
      title: '', base: state.bases[0].id, table: '', view: '',
    };
  }
  return null;
}

async function connected() {
  state.view = 'main';
  state.busy = 'Connecting…';
  state.error = null;
  panel.render();
  try {
    await loadBases();
    state.source = pickStart();
    if (state.source && !state.source.table) {
      const tables = await state.conn.tables(state.source.base);
      tables.base = state.source.base;
      state.tables = tables;
      state.source.table = tables[0]?.id || '';
    }
    state.busy = '';
    if (state.source?.table) await loadRecords();
    else panel.render();
  } catch (error) {
    if (state.conn.mode === 'token' && [401, 403].includes(error.status)) {
      state.view = 'connect';
      state.connectError = error.message;
      state.busy = '';
      panel.render();
      return;
    }
    fail(error);
  }
}

function startConnection() {
  const worker = state.settings['worker-url'];
  if (state.mode === 'demo') return;
  if (worker && state.context) {
    const { org, repo: site, path } = state.context;
    state.conn = workerConnection(worker, () => state.ims, { org, site, path });
  } else {
    const token = savedToken();
    if (!token) {
      state.view = 'connect';
      panel.render();
      return;
    }
    state.conn = tokenConnection(token);
  }
  connected();
}

async function startDemo() {
  state.mode = 'demo';
  const resp = await fetch(new URL('./demo/northwind.json', import.meta.url));
  const data = await resp.json();
  state.conn = demoConnection(data);
  const [base] = data.bases;
  state.sources = [
    ['Savings rates', 'table'], ['Accounts', 'cards'], ['FAQs', 'accordion'], ['Branches', 'text'],
  ].map(([title, format]) => ({
    title, base: base.id, table: title, view: '', fields: title === 'FAQs' ? ['Question', 'Answer'] : [], format,
  }));
  connected();
}

async function startLive(sdk) {
  state.sdk = sdk;
  const { context } = sdk;
  state.context = {
    org: context.org,
    repo: context.repo || context.site,
    path: (context.path || '/').replace(/\.html$/, ''),
  };
  state.ims = sdk.token;
  state.mode = sdk.capabilities?.liveDocument === 1 ? 'ew' : 'da';
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) state.ims = e.data.token;
  });
  if (state.mode === 'ew') {
    try {
      sdk.actions.subscribeLiveDocument(({ selection, editable }) => {
        state.live = { blockIndex: selection?.blockIndex ?? null, editable: editable !== false };
        panel.renderFooter();
      });
    } catch {
      // Older hosts: insert at the cursor without the block check.
    }
  }
  const json = await loadSiteConfig(sdk.token, state.context);
  state.settings = parseSettings(json, window.location.search);
  state.sources = parseSources(json);
  startConnection();
}

/* Actions used by the panel */

async function connectToken(token) {
  const clean = String(token || '').trim();
  if (!TOKEN_PATTERN.test(clean)) {
    state.connectError = 'That does not look like an Airtable personal access token. It starts with “pat” and has a dot in the middle.';
    panel.render();
    return;
  }
  state.connectError = '';
  state.conn = tokenConnection(clean);
  try {
    state.busy = 'Checking the token…';
    panel.render();
    await state.conn.bases(true);
    saveToken(clean);
    await connected();
  } catch (error) {
    state.busy = '';
    state.view = 'connect';
    state.connectError = error.message;
    panel.render();
  }
}

function disconnect() {
  saveToken('');
  state.conn = null;
  state.view = 'connect';
  state.source = null;
  state.table = null;
  state.records = [];
  state.tables = [];
  state.bases = [];
  panel.render();
}

function chooseSource(index) {
  const source = state.sources[index];
  if (!source) return;
  state.source = { ...source };
  state.table = null;
  loadRecords();
}

async function chooseBase(base) {
  state.source = {
    title: '', base, table: '', view: '',
  };
  state.table = null;
  state.records = [];
  state.busy = 'Loading tables…';
  panel.render();
  try {
    const tables = await state.conn.tables(base);
    tables.base = base;
    state.tables = tables;
    state.source.table = tables[0]?.id || '';
    state.busy = '';
    if (state.source.table) await loadRecords();
    else panel.render();
  } catch (error) {
    fail(error);
  }
}

function chooseTable(table) {
  state.source = {
    ...state.source, title: '', table, view: '', fields: [], format: '',
  };
  state.table = null;
  loadRecords();
}

function chooseView(view) {
  state.source = { ...state.source, view };
  loadRecords();
}

function setFormat(format) {
  if (!FORMATS[format]) return;
  state.format = format;
  applyDefaults();
  panel.render();
}

function toggleField(id) {
  const field = state.table.fields.find((f) => f.id === id);
  if (!field) return;
  state.fieldsTouched = true;
  if (state.fields.some((f) => f.id === id)) state.fields = state.fields.filter((f) => f.id !== id);
  else state.fields = orderFields(state.table, [...state.fields.map((f) => f.name), field.name]);
  panel.render();
}

function moveField(id) {
  const at = state.fields.findIndex((f) => f.id === id);
  if (at <= 0) return;
  const next = [...state.fields];
  [next[at - 1], next[at]] = [next[at], next[at - 1]];
  state.fields = next;
  state.fieldsTouched = true;
  panel.render();
}

function toggleRecord(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  panel.renderRecords();
}

function selectAll(on) {
  const shown = searchRecords(state.records, state.query);
  shown.forEach((r) => (on ? state.selected.add(r.id) : state.selected.delete(r.id)));
  panel.renderRecords();
}

function chosenRecords() {
  return state.records.filter((r) => state.selected.has(r.id));
}

function contentHtml(imageSrc) {
  return buildContent(state.format, state.fields, chosenRecords(), {
    ...state.options,
    linkText: state.settings['link-text'],
    ...(imageSrc ? { imageSrc } : {}),
  });
}

async function insert() {
  const records = chosenRecords();
  if (!records.length || !state.fields.length) return;
  if (state.mode === 'demo') {
    panel.toast('Sample mode: open the panel from Experience Workspace to insert. Copy works here too.');
    return;
  }
  if (!state.live.editable) {
    panel.toast('You cannot edit this page, so nothing was inserted.');
    return;
  }
  if (state.mode === 'ew' && state.live.blockIndex !== null && state.format !== 'text') {
    panel.toast('Your cursor is inside a block. Click an empty line outside it, then press Insert again.');
    return;
  }
  const images = imagesIn(state.format, state.fields, records, state.options);
  let map = new Map();
  if (images.length) {
    state.busy = `Copying ${images.length} image${images.length === 1 ? '' : 's'} to the site…`;
    panel.render();
    const { copied, failed } = await copyImages(images, {
      org: state.context.org,
      repo: state.context.repo,
      token: state.ims,
      folder: state.settings['image-folder'],
      onProgress: (done, total) => panel.setBusy(`Copying images to the site… ${done} of ${total}`),
    });
    map = copied;
    if (failed.length) {
      state.busy = '';
      panel.render();
      panel.toast(`${failed.length} image${failed.length === 1 ? '' : 's'} could not be copied into the site, so nothing was inserted. Try again.`);
      return;
    }
  }
  const html = contentHtml((att) => map.get(att.url) || att.url);
  try {
    await state.sdk.actions.sendHTML(html);
    state.busy = '';
    panel.render();
    const what = FORMATS[state.format].block || 'text';
    panel.toast(`Inserted ${records.length} record${records.length === 1 ? '' : 's'} as ${what}.`);
  } catch (error) {
    fail(error);
  }
}

async function copy() {
  const html = contentHtml();
  if (!html) return;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([holder.innerText], { type: 'text/plain' }),
    })]);
    panel.toast('Copied. Paste it into the page.');
  } catch {
    panel.toast('Copy is blocked here. Use Insert instead.');
  }
}

function refresh() {
  if (!state.conn) return;
  state.conn.clear?.();
  loadRecords(true);
}

function init() {
  panel = createPanel(document.querySelector('main'), state, {
    connectToken,
    disconnect,
    chooseSource,
    chooseBase,
    chooseTable,
    chooseView,
    setFormat,
    setOption: (key, value) => {
      state.options[key] = value;
      panel.render();
    },
    toggleField,
    moveField,
    toggleRecord,
    selectAll,
    search: (query) => {
      state.query = query;
      panel.renderRecords();
    },
    insert,
    copy,
    refresh,
    tryDemo: startDemo,
    contentHtml: () => contentHtml(),
  });
  panel.render();
  const embedded = window.parent !== window && !params.has('demo');
  const sdk = embedded
    ? Promise.race([DA_SDK, new Promise((r) => { setTimeout(() => r(null), SDK_TIMEOUT); })])
    : Promise.resolve(null);
  sdk.then((found) => (found?.context?.org ? startLive(found) : startDemo()))
    .catch(fail);
}

init();
