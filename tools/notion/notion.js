// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  DA_ADMIN, parseSettings, parseSources, loadSiteConfig,
} from './lib/config.js';
import { workerConnection, demoConnection } from './lib/connection.js';
import {
  convertPage, documentHtml, suggestPath, cleanPath,
} from './lib/convert.js';
import { copyImages } from './lib/images.js';
import createPanel from './panel.js';

const params = new URLSearchParams(window.location.search);
const SDK_TIMEOUT = 4000;
const SEARCH_DELAY = 350;
const LAST_KEY = 'ew-notion:last';
const SEARCH = '__search';

const state = {
  mode: 'loading',
  sdk: null,
  context: null,
  ims: '',
  settings: parseSettings(null, window.location.search),
  sources: [],
  databases: [],
  conn: null,
  view: 'loading',
  source: null,
  pages: [],
  more: false,
  query: '',
  current: null,
  options: { title: true, metadata: true, sections: true },
  path: '',
  created: null,
  live: { blockIndex: null, editable: true },
  busy: '',
  error: null,
};

let panel;
let loadSeq = 0;
let searchTimer;

const storeKey = () => `${LAST_KEY}:${state.context?.org}/${state.context?.repo}`;

function remember() {
  try {
    if (state.source) localStorage.setItem(storeKey(), JSON.stringify(state.source));
  } catch {
    // Not important.
  }
}

function recalled() {
  try {
    return JSON.parse(localStorage.getItem(storeKey()) || 'null');
  } catch {
    return null;
  }
}

function fail(error) {
  state.error = error;
  state.busy = '';
  panel.render();
}

function convertOptions(extra = {}) {
  return {
    ...state.options,
    description: state.settings['description-property'],
    keywords: state.settings['keywords-property'],
    ...extra,
  };
}

function converted(extra) {
  return state.current ? convertPage(state.current, convertOptions(extra)) : null;
}

/* Loading */

async function loadPages(fresh = false) {
  const { source } = state;
  if (!source) return;
  loadSeq += 1;
  const seq = loadSeq;
  state.busy = source.id === SEARCH ? 'Searching Notion…' : 'Loading pages…';
  state.error = null;
  panel.render();
  try {
    const result = source.id === SEARCH
      ? await state.conn.search(state.query, fresh)
      : await state.conn.database(source.id, fresh);
    if (seq !== loadSeq) return;
    const wanted = (source.status || []).map((s) => s.toLowerCase());
    state.pages = wanted.length
      ? result.pages.filter((p) => wanted.includes(String(p.properties.find((x) => x.name === 'Status')?.value || '').toLowerCase()))
      : result.pages;
    state.more = !!result.more;
    state.busy = '';
    remember();
    panel.render();
  } catch (error) {
    if (seq === loadSeq) fail(error);
  }
}

function pickStart() {
  const last = recalled();
  const all = [...state.sources, ...state.databases.map((d) => ({ title: d.title, id: d.id }))];
  const browse = state.settings['allow-browse'] !== 'no' || !state.sources.length;
  const match = last && all.find((s) => s.id === last.id && s.title === last.title);
  if (match) return match;
  if (last?.id === SEARCH && browse) return { id: SEARCH, title: 'All shared pages' };
  if (state.sources[0]) return state.sources[0];
  if (state.databases[0]) return { title: state.databases[0].title, id: state.databases[0].id };
  return browse ? { id: SEARCH, title: 'All shared pages' } : null;
}

async function connected() {
  state.view = 'main';
  state.busy = 'Connecting to Notion…';
  state.error = null;
  panel.render();
  try {
    if (state.settings['allow-browse'] !== 'no' || !state.sources.length) {
      state.databases = await state.conn.databases();
    }
    state.source = pickStart();
    state.busy = '';
    if (state.source) await loadPages();
    else panel.render();
  } catch (error) {
    fail(error);
  }
}

async function startDemo() {
  state.mode = 'demo';
  state.view = 'main';
  const resp = await fetch(new URL('./demo/northwind.json', import.meta.url));
  const data = await resp.json();
  state.conn = demoConnection(data);
  state.sources = [{ title: 'Content briefs', id: data.databases[0].id.replace(/-/g, ''), status: [] }];
  state.settings = { ...state.settings, 'allow-browse': 'yes' };
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
  state.sources = parseSources(json)
    .map((s) => ({ title: s.title, id: s.database, status: s.status }));
  const worker = state.settings['worker-url'];
  if (!worker) {
    state.view = 'setup';
    panel.render();
    return;
  }
  const { org, repo: site, path } = state.context;
  state.conn = workerConnection(worker, () => state.ims, { org, site, path });
  connected();
}

/* Actions used by the panel */

function chooseSource(value) {
  const [kind, index] = value.split(':');
  const db = state.databases[Number(index)];
  if (value === SEARCH) state.source = { id: SEARCH, title: 'All shared pages' };
  else if (kind === 's') state.source = state.sources[Number(index)];
  else if (db) state.source = { title: db.title, id: db.id };
  state.query = '';
  state.current = null;
  loadPages();
}

function search(query) {
  state.query = query;
  if (state.source?.id !== SEARCH) {
    panel.renderPages();
    return;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadPages(), SEARCH_DELAY);
}

async function openPage(id) {
  state.busy = 'Reading the Notion page…';
  state.error = null;
  state.created = null;
  panel.render();
  try {
    state.current = await state.conn.page(id);
    state.path = suggestPath(state.current.page, {
      pathProperty: state.settings['path-property'],
      folder: state.settings['new-page-folder'],
    });
    state.busy = '';
    panel.render();
    panel.scrollTop();
  } catch (error) {
    fail(error);
  }
}

function back() {
  state.current = null;
  state.created = null;
  state.error = null;
  panel.render();
}

async function imageMap() {
  const { images } = converted();
  if (!images.length) return new Map();
  state.busy = `Copying ${images.length} image${images.length === 1 ? '' : 's'} to the site…`;
  panel.render();
  const { copied, failed } = await copyImages(images, {
    org: state.context.org,
    repo: state.context.repo,
    token: state.ims,
    folder: state.settings['image-folder'],
    fallback: (url) => state.conn.file(url),
    onProgress: (done, total) => panel.setBusy(`Copying images to the site… ${done} of ${total}`),
  });
  if (failed.length) {
    throw new Error(`${failed.length} image${failed.length === 1 ? '' : 's'} could not be copied into the site, so nothing was changed. Try again.`);
  }
  return copied;
}

async function insert() {
  if (!state.current) return;
  if (state.mode === 'demo') {
    panel.toast('Sample mode: open the panel from Experience Workspace to insert. Copy works here too.');
    return;
  }
  if (!state.live.editable) {
    panel.toast('You cannot edit this page, so nothing was inserted.');
    return;
  }
  if (state.mode === 'ew' && state.live.blockIndex !== null) {
    panel.toast('Your cursor is inside a block. Click an empty line outside it, then press Insert again.');
    return;
  }
  try {
    const map = await imageMap();
    const { html } = converted({ imageSrc: (url) => map.get(url) || url });
    await state.sdk.actions.sendHTML(html);
    state.busy = '';
    panel.render();
    panel.toast(`Inserted “${state.current.page.title}”.`);
  } catch (error) {
    state.busy = '';
    panel.render();
    panel.toast(error.message || String(error));
  }
}

async function exists(path) {
  const resp = await fetch(`${DA_ADMIN}/source/${state.context.org}/${state.context.repo}${path}.html`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${state.ims}` },
  });
  if (resp.status === 404) return false;
  if (resp.ok) return true;
  throw new Error(`Document Authoring answered ${resp.status} when checking ${path}.`);
}

async function createPage() {
  if (!state.current) return;
  if (state.mode === 'demo') {
    panel.toast('Sample mode: open the panel from Experience Workspace to create pages.');
    return;
  }
  const path = cleanPath(state.path);
  if (!path || path === '/') {
    panel.toast('Type a path for the new page, like /offers/spring-savings.');
    return;
  }
  const { org, repo } = state.context;
  const { page } = state.current;
  try {
    state.busy = 'Checking the path…';
    panel.render();
    if (await exists(path)) {
      throw new Error(`There is already a page at ${path}. Choose another path, or open that page and use Insert.`);
    }
    const map = await imageMap();
    const { sections } = converted({ imageSrc: (url) => map.get(url) || url });
    panel.setBusy('Creating the page…');
    const form = new FormData();
    form.append('data', new Blob([documentHtml(sections)], { type: 'text/html' }));
    const put = await fetch(`${DA_ADMIN}/source/${org}/${repo}${path}.html`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${state.ims}` },
      body: form,
    });
    if (!put.ok) throw new Error(`Document Authoring answered ${put.status}, so the page was not created.`);
    const url = `https://da.live/canvas#/${org}/${repo}${path}`;
    state.created = { path, url, linked: '' };
    panel.setBusy('Linking the page in Notion…');
    try {
      const result = await state.conn.link(page.id, url);
      state.created.linked = result.property || state.settings['link-property'] || 'EW page';
    } catch (error) {
      state.created.linkError = error.message;
    }
    state.busy = '';
    panel.render();
  } catch (error) {
    state.busy = '';
    panel.render();
    panel.toast(error.message || String(error));
  }
}

async function copy() {
  const result = converted();
  if (!result?.html) return;
  const holder = document.createElement('div');
  holder.innerHTML = result.html;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([result.html], { type: 'text/html' }),
      'text/plain': new Blob([holder.innerText], { type: 'text/plain' }),
    })]);
    panel.toast('Copied. Paste it into the page.');
  } catch {
    panel.toast('Copy is blocked here. Use Insert instead.');
  }
}

async function refresh() {
  if (!state.conn) return;
  state.conn.clear?.();
  if (state.current) {
    await openPage(state.current.page.id);
    return;
  }
  loadPages(true);
}

function init() {
  panel = createPanel(document.querySelector('main'), state, {
    chooseSource,
    search,
    openPage,
    back,
    setOption: (key, value) => {
      state.options[key] = value;
      panel.renderPreview();
    },
    setPath: (value) => { state.path = value; },
    insert,
    createPage,
    copy,
    refresh,
    tryDemo: startDemo,
    converted: () => converted(),
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
