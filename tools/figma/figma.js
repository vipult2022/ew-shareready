// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { DA_ADMIN, parseSettings, loadSiteConfig } from './lib/config.js';
import { workerConnection, demoConnection } from './lib/connection.js';
import { analyze } from './lib/design.js';
import {
  convert, documentHtml, suggestPath, cleanPath,
} from './lib/convert.js';
import { designCheck } from './lib/check.js';
import buildPrompt from './lib/prompt.js';
import { copyImages } from './lib/images.js';
import createPanel from './panel.js';

const params = new URLSearchParams(window.location.search);
const SDK_TIMEOUT = 4000;
const CHECK_DELAY = 400;
const COPIED_KEY = 'ew-figma:copied';
const DEMO_URL = new URL('./demo/handoff.json', import.meta.url);

const state = {
  mode: 'loading',
  sdk: null,
  context: null,
  ims: '',
  settings: parseSettings(null, window.location.search),
  conn: null,
  view: 'loading',
  list: [],
  thumbs: new Map(),
  current: null,
  copied: null,
  html: '',
  check: null,
  path: '',
  created: null,
  live: { blockIndex: null, editable: true },
  aiPending: false,
  busy: '',
  error: null,
};

let panel;
let checkTimer;
let openSeq = 0;

function fail(error) {
  state.error = error;
  state.busy = '';
  panel.render();
}

function done(message) {
  state.busy = '';
  panel.render();
  if (message) panel.toast(message);
}

/* Pictures copied into the site, remembered per design version so later checks know them. */

function copiedKey() {
  const { org, repo } = state.context || {};
  const { id, sent } = state.current?.handoff || {};
  return `${COPIED_KEY}:${org}/${repo}/${id}/${sent}`;
}

function recallCopied() {
  if (state.mode === 'demo') {
    const files = state.current.handoff.files || {};
    return new Map(Object.entries(files).map(([id, file]) => [id, new URL(file, DEMO_URL).href]));
  }
  try {
    const saved = JSON.parse(localStorage.getItem(copiedKey()) || 'null');
    return saved ? new Map(Object.entries(saved)) : null;
  } catch {
    return null;
  }
}

function rememberCopied(map) {
  try {
    localStorage.setItem(copiedKey(), JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Only used to re-check later.
  }
}

function pictures() {
  const seen = new Map();
  state.current.model.items.filter((i) => i.kind === 'image').forEach((i) => {
    if (!seen.has(i.image)) seen.set(i.image, { image: i.image, name: i.alt || i.name });
  });
  return [...seen.values()];
}

async function imageMap() {
  const wanted = pictures();
  if (state.copied && wanted.every((p) => state.copied.has(p.image))) return state.copied;
  if (!wanted.length) return new Map();
  const { handoff } = state.current;
  panel.setBusy(`Copying ${wanted.length} picture${wanted.length === 1 ? '' : 's'} into the site…`);
  const { copied, failed } = await copyImages(wanted, {
    org: state.context.org,
    repo: state.context.repo,
    token: state.ims,
    folder: state.settings['image-folder'],
    download: (image) => state.conn.image(handoff.id, image),
    onProgress: (n, total) => panel.setBusy(`Copying pictures into the site… ${n} of ${total}`),
  });
  if (failed.length) {
    throw new Error(`${failed.length} picture${failed.length === 1 ? '' : 's'} could not be copied into the site, so nothing was changed. Try again.`);
  }
  state.copied = copied;
  rememberCopied(copied);
  return copied;
}

/* Design check */

function sampleBuiltPage() {
  // What an assistant run often looks like: everything but one section, and a missing link.
  const { model } = state.current;
  const kept = model.sections.filter((s) => s.block !== 'Accordion');
  return convert({ ...model, sections: kept }, { imageSrc: (id) => state.copied?.get(id) || '' }).html;
}

function runCheck() {
  if (!state.current) return;
  const { model } = state.current;
  let html = state.html || '';
  let source = state.mode === 'ew' ? 'live' : 'saved';
  if (state.mode === 'demo') {
    html = sampleBuiltPage();
    source = 'sample';
  }
  if (state.mode === 'da' && !state.html) {
    state.check = null;
    panel.renderCheck();
    return;
  }
  const known = !!state.copied;
  const checked = known ? model : { ...model, items: model.items.filter((i) => i.kind !== 'image') };
  state.check = {
    ...designCheck(checked, html, { imageUrl: (id) => state.copied?.get(id) || '' }),
    source,
    picturesUnknown: !known && model.stats.images > 0,
    empty: !html.replace(/<[^>]+>/g, '').trim(),
  };
  panel.renderCheck();
}

function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, CHECK_DELAY);
}

async function readSavedPage() {
  const { org, repo, path } = state.context;
  panel.setBusy('Reading this page…');
  try {
    const resp = await fetch(`${DA_ADMIN}/source/${org}/${repo}${path}.html`, {
      headers: { Authorization: `Bearer ${state.ims}` },
    });
    if (!resp.ok) throw new Error(`Document Authoring answered ${resp.status} when reading this page.`);
    state.html = await resp.text();
    state.busy = '';
    panel.setBusy('');
    runCheck();
  } catch (error) {
    done(error.message);
  }
}

/* Inbox */

function loadThumbs() {
  state.list.filter((h) => h.thumbnail).forEach((h) => {
    const key = `${h.id}|${h.sent}`;
    if (state.thumbs.has(key)) return;
    state.thumbs.set(key, '');
    state.conn.image(h.id, 'thumbnail')
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        state.thumbs.set(key, url);
        panel.setThumb(key, url);
      })
      .catch(() => {});
  });
}

async function loadList() {
  state.busy = 'Loading designs…';
  state.error = null;
  panel.render();
  try {
    state.list = await state.conn.list();
    state.busy = '';
    panel.render();
    loadThumbs();
  } catch (error) {
    fail(error);
  }
}

async function openDesign(id, fresh = false) {
  openSeq += 1;
  const seq = openSeq;
  state.busy = 'Opening the design…';
  state.error = null;
  state.created = null;
  state.check = null;
  panel.render();
  try {
    const handoff = await state.conn.get(id, fresh);
    if (seq !== openSeq) return;
    state.current = { handoff, model: analyze(handoff) };
    state.copied = recallCopied();
    state.path = suggestPath(handoff, state.settings['new-page-folder']);
    state.busy = '';
    panel.render();
    panel.scrollTop();
    if (state.mode === 'da' && !state.html) readSavedPage();
    else runCheck();
  } catch (error) {
    if (seq === openSeq) fail(error);
  }
}

function back() {
  state.current = null;
  state.created = null;
  state.check = null;
  state.error = null;
  panel.render();
  loadThumbs();
}

/* Building */

function prompt(map) {
  const { handoff, model } = state.current;
  const src = map || state.copied || new Map();
  return buildPrompt(handoff, model, {
    imageSrc: (id) => src.get(id) || `(picture “${id}”, copied into the site when you build)`,
    blocks: state.settings.blocks,
  });
}

function canEdit() {
  if (!state.live.editable) {
    panel.toast('You cannot edit this page, so nothing was changed.');
    return false;
  }
  if (state.mode === 'ew' && state.live.blockIndex !== null) {
    panel.toast('Your cursor is inside a block. Click an empty line outside it, then try again.');
    return false;
  }
  return true;
}

async function buildWithAi() {
  if (!state.current) return;
  if (state.mode !== 'ew') {
    panel.toast(state.mode === 'demo'
      ? 'Sample mode: open the panel from Experience Workspace to build with the assistant. The request it gets is under “What the assistant gets”.'
      : 'Open this panel from Experience Workspace to use the assistant, or use Insert.');
    return;
  }
  if (!canEdit()) return;
  try {
    const map = await imageMap();
    state.sdk.actions.setPrompt(prompt(map), { autoSend: true });
    state.aiPending = true;
    done('Sent to the assistant. The design check updates as the page changes.');
  } catch (error) {
    done(error.message || String(error));
  }
}

async function insert() {
  if (!state.current) return;
  if (state.mode === 'demo') {
    panel.toast('Sample mode: open the panel from Experience Workspace to insert.');
    return;
  }
  if (!canEdit()) return;
  try {
    const map = await imageMap();
    const { html } = convert(state.current.model, { imageSrc: (id) => map.get(id) || '' });
    await state.sdk.actions.sendHTML(html);
    done(`Inserted “${state.current.handoff.name}”.`);
    if (state.mode === 'da') readSavedPage();
  } catch (error) {
    done(error.message || String(error));
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

const editorUrl = (path) => `https://da.live/canvas#/${state.context.org}/${state.context.repo}${path}`;

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
  try {
    state.busy = 'Checking the path…';
    panel.render();
    if (await exists(path)) {
      throw new Error(`There is already a page at ${path}. Choose another path, or open that page and build it there.`);
    }
    const map = await imageMap();
    const { sections } = convert(state.current.model, { imageSrc: (id) => map.get(id) || '' });
    panel.setBusy('Creating the page…');
    const form = new FormData();
    form.append('data', new Blob([documentHtml(sections)], { type: 'text/html' }));
    const { org, repo } = state.context;
    const put = await fetch(`${DA_ADMIN}/source/${org}/${repo}${path}.html`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${state.ims}` },
      body: form,
    });
    if (!put.ok) throw new Error(`Document Authoring answered ${put.status}, so the page was not created.`);
    state.created = { path, url: editorUrl(path) };
    done();
  } catch (error) {
    done(error.message || String(error));
  }
}

async function setStatus(status) {
  if (!state.current) return;
  const { handoff } = state.current;
  const url = state.created?.url || (state.context ? editorUrl(state.context.path) : '');
  try {
    state.busy = status === 'built' ? 'Telling the designer…' : 'Updating…';
    panel.render();
    await state.conn.status(handoff.id, status, status === 'built' ? url : '');
    handoff.status = status;
    if (status === 'built') handoff.url = url;
    const row = state.list.find((h) => h.id === handoff.id);
    if (row) Object.assign(row, { status, url: handoff.url });
    const who = handoff.sender ? handoff.sender.replace(/\s*\(.*\)$/, '') : 'The designer';
    done(status === 'built' ? `Marked built. ${who} sees it in Figma under Sent.` : 'Marked as not built yet.');
  } catch (error) {
    done(error.message || String(error));
  }
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(prompt());
    panel.toast('Copied. Paste it into the assistant.');
  } catch {
    panel.toast('Copy is blocked here. Select the text and copy it.');
  }
}

function refresh() {
  if (!state.conn) return;
  if (state.current) openDesign(state.current.handoff.id, true);
  else loadList();
}

/* Start */

async function startDemo() {
  state.mode = 'demo';
  state.view = 'main';
  state.context = { org: 'demo', repo: 'northwind', path: '/drafts/figma' };
  const resp = await fetch(DEMO_URL);
  const handoffs = await resp.json();
  const sent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  handoffs.forEach((item) => { item.sent = sent; });
  state.conn = demoConnection(handoffs, { base: DEMO_URL.href });
  await loadList();
  const wanted = params.get('design');
  if (wanted && state.list.some((h) => h.id === wanted)) openDesign(wanted);
}

function onLiveDocument({ html, selection, editable }) {
  state.live = { blockIndex: selection?.blockIndex ?? null, editable: editable !== false };
  panel.renderFooter();
  if (typeof html === 'string' && html !== state.html) {
    state.html = html;
    scheduleCheck();
  }
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
      sdk.actions.subscribeLiveDocument(onLiveDocument);
    } catch {
      state.mode = 'da';
    }
    try {
      sdk.actions.subscribeChatTurnCompleted(() => {
        if (!state.aiPending) return;
        state.aiPending = false;
        panel.toast('Assistant finished. Check the design check below before you mark it built.');
      });
    } catch {
      // Older hosts have no chat notifications.
    }
  }
  const json = await loadSiteConfig(sdk.token, state.context);
  state.settings = parseSettings(json, window.location.search);
  const worker = state.settings['worker-url'];
  if (!worker) {
    state.view = 'setup';
    panel.render();
    return;
  }
  const { org, repo: site, path } = state.context;
  state.conn = workerConnection(worker, () => state.ims, { org, site, path });
  state.view = 'main';
  loadList();
}

function init() {
  panel = createPanel(document.querySelector('main'), state, {
    openDesign,
    back,
    refresh,
    buildWithAi,
    insert,
    createPage,
    setPath: (value) => { state.path = value; },
    markBuilt: () => setStatus('built'),
    reopen: () => setStatus('new'),
    checkAgain: () => (state.mode === 'da' ? readSavedPage() : runCheck()),
    copyPrompt,
    prompt: () => prompt(),
    tryDemo: () => startDemo().catch(fail),
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
