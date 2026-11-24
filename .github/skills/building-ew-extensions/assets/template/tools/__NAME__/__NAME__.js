// The SDK import must stay static and first: EW sends its one-time init message as soon as
// the iframe loads, and a late or dynamic import can miss it.
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { parseSettings, loadSiteConfig, docPath } from './lib/config.js';
import { workerConnection, demoConnection } from './lib/connection.js';
import { itemHtml, itemText, insertBlocker } from './lib/html.js';
import createPanel from './panel.js';

const params = new URLSearchParams(window.location.search);
const SDK_TIMEOUT = 4000;

const state = {
  mode: 'loading', // loading | demo | ew (live document) | da (classic editor)
  view: 'loading', // loading | setup | main
  sdk: null,
  context: null,
  token: '',
  settings: parseSettings(null, window.location.search),
  conn: null,
  items: [],
  query: '',
  current: null,
  live: { blockIndex: null, editable: true },
  busy: '',
  error: null,
};

let panel;
let loadSeq = 0;

function fail(error) {
  state.error = error instanceof Error ? error : new Error(String(error));
  state.busy = '';
  panel.render();
}

/* Loading */

async function loadItems() {
  if (!state.conn) return;
  loadSeq += 1;
  const seq = loadSeq;
  state.busy = 'Loading…';
  state.error = null;
  panel.render();
  try {
    const items = await state.conn.items();
    // A slower, older request must not overwrite newer results.
    if (seq !== loadSeq) return;
    state.items = items;
    state.current = state.current && items.find((i) => i.id === state.current.id);
    state.busy = '';
    panel.render();
  } catch (error) {
    if (seq === loadSeq) fail(error);
  }
}

async function startDemo() {
  state.mode = 'demo';
  state.view = 'main';
  state.error = null;
  try {
    const resp = await fetch(new URL('./demo/sample.json', import.meta.url));
    if (!resp.ok) throw new Error(`The sample data could not be loaded (${resp.status}).`);
    state.conn = demoConnection(await resp.json());
    await loadItems();
  } catch (error) {
    fail(error);
  }
}

async function startLive(sdk) {
  state.sdk = sdk;
  const { context } = sdk;
  state.context = {
    org: context.org,
    repo: context.repo || context.site,
    path: docPath(context.path),
  };
  state.token = sdk.token;
  state.mode = sdk.capabilities?.liveDocument === 1 ? 'ew' : 'da';
  // EW posts a fresh token when the old one expires; always read state.token at call time.
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) state.token = e.data.token;
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
  const json = await loadSiteConfig(state.token, state.context);
  state.settings = parseSettings(json, window.location.search);
  const worker = state.settings['worker-url'];
  if (!worker) {
    state.view = 'setup';
    panel.render();
    return;
  }
  state.view = 'main';
  const { org, repo: site, path } = state.context;
  state.conn = workerConnection(worker, () => state.token, { org, site, path });
  await loadItems();
}

/* Actions used by the panel */

function choose(id) {
  state.current = state.items.find((item) => item.id === id) || null;
  panel.render();
}

function back() {
  state.current = null;
  panel.render();
}

async function insert() {
  const item = state.current;
  if (!item) return;
  const blocked = insertBlocker(state);
  if (blocked) {
    panel.toast(blocked);
    return;
  }
  try {
    await state.sdk.actions.sendHTML(itemHtml(item, state.settings));
    panel.toast(`Inserted “${item.title}”.`);
  } catch (error) {
    panel.toast(error?.message || String(error));
  }
}

async function copy() {
  const item = state.current;
  if (!item) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([itemHtml(item, state.settings)], { type: 'text/html' }),
      'text/plain': new Blob([itemText(item)], { type: 'text/plain' }),
    })]);
    panel.toast('Copied. Paste it into the page.');
  } catch {
    panel.toast('Copy is blocked here. Use Insert instead.');
  }
}

function search(query) {
  state.query = query;
  panel.renderList();
}

function refresh() {
  if (state.conn) loadItems();
  else {
    state.error = null;
    panel.render();
  }
}

function init() {
  panel = createPanel(document.querySelector('main'), state, {
    choose, back, insert, copy, search, refresh, tryDemo: startDemo,
  });
  panel.render();
  // DA_SDK never resolves outside EW, so race it and fall back to sample data.
  const embedded = window.parent !== window && !params.has('demo');
  const sdk = embedded
    ? Promise.race([DA_SDK, new Promise((r) => { setTimeout(() => r(null), SDK_TIMEOUT); })])
    : Promise.resolve(null);
  sdk.then((found) => (found?.context?.org ? startLive(found) : startDemo())).catch(fail);
}

init();
