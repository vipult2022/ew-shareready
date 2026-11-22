/* The controller: connects the panel to the page EW is editing. It reads the live
 * document, turns the selected block into a model, writes edits back with
 * sendHTML(replace) and keeps an undo history of what it wrote. */
/* Handlers call each other in both directions (save ↔ follow the page), so they are
 * declared as hoisted functions. */
/* eslint-disable no-use-before-define */
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import createPanel from './panel.js';
import {
  parseHtml, blockElements, cleanBlock, signature, outline, previewUrl, classesOf, blockName,
} from './lib/live.js';
import {
  parseBlock, layout, applyOp, applyOps, pushOp, buildBlock, items, options, findField, ICON_TOKEN,
} from './lib/model.js';
import {
  DA_ADMIN, makeFetcher, loadSiteSettings, blockRules, libraryBlock, exampleFieldsFor,
  withLibraryFields, parseRules, parseLibraryOptions, parseOptionDefs, parseItemFields,
  parseMultiBlocks,
} from './lib/rules.js';
import { checkBlock } from './lib/check.js';
import { fieldPrompt, altPrompt, briefPrompt } from './lib/ai.js';
import {
  createDemoHost, DEMO_RULES, DEMO_LIBRARY, demoLibraryFetch, cannedEdit,
} from './lib/demo.js';

const SDK_TIMEOUT = 4000;
const SETTINGS_TIMEOUT = 6000;
const DA_CONTENT = 'https://content.da.live';
const MAX_UPLOAD = 20 * 1024 * 1024;
const HISTORY_LIMIT = 50;
const SHELF_LIMIT = 20;
const COALESCE_MS = 4000;
const SLOW_AI_MS = 60000;
const STALE_RETRIES = 3;

const params = new URLSearchParams(window.location.search);
const doc = document.implementation.createHTMLDocument('');
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const title = (text) => String(text || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const withTimeout = (promise, ms, fallback) => Promise.race([
  promise.catch(() => fallback),
  wait(ms).then(() => fallback),
]);

const state = {
  phase: 'loading',
  mode: 'live',
  blocks: [],
  target: null,
  model: null,
  view: null,
  issues: [],
  rules: null,
  open: new Set([1]),
  editable: true,
  status: { kind: 'idle', text: '', actions: [] },
  history: { canUndo: false, canRedo: false },
  ai: {
    available: false, busy: false, slow: false, label: '', undo: null,
  },
  addingOption: '',
  showIssues: false,
  briefOpen: false,
  libraryVariants: [],
  icons: [],
  rulesFound: false,
  error: '',
};

let panel;
let host = null;
let context = {};
let settings = {
  rules: [],
  libraryOptions: new Map(),
  optionDefs: new Map(),
  itemFields: new Map(),
  multiBlocks: new Set(),
  libraryBlocks: [],
  loaded: false,
};
let token = '';
const fetcher = makeFetcher(() => token);
let libraryFetch = fetcher;
let pageUrl = '';

let lastHtml = '';
let liveDoc = parseHtml('');
let selected = null;
let base = '';

let ops = [];
let writing = false;
let stash = null;
let timer = null;
let staleTries = 0;
let queue = Promise.resolve();

let undoStack = [];
let redoStack = [];
const shelf = new Map();
let seq = 0;

const images = new Map();
const uploading = new Set();
let aiSnap = null;
let aiTimer = null;
let pageIcons = [];
let siteIcons = [];
const libraryCache = new Map();
const libraryLoaded = new Map();

/* Small helpers */

const render = (force) => panel.render(force);
const blockAt = (index) => (index == null ? null : blockElements(liveDoc)[index] || null);
const blockTitle = () => title(state.model?.name || 'selected');
const hintsFor = (rules) => ({
  knownKeys: rules.knownKeys,
  options: rules.options,
  items: rules.items,
  noun: rules.noun,
  multi: rules.multi,
  imageKeys: rules.imageKeys,
  schema: rules.itemFields,
});

function setStatus(kind, text = '', actions = []) {
  state.status = { kind, text, actions };
}

function setHistory() {
  state.history = { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

function derive() {
  if (!state.model) return;
  state.view = layout(state.model, doc);
  state.issues = checkBlock(state.view, state.rules, doc, images);
}

/** Where the block with this signature is now, preferring the index it had. */
function locate(sig, hint) {
  const els = blockElements(liveDoc);
  if (hint != null && els[hint] && signature(els[hint]) === sig) return hint;
  const at = els.findIndex((el) => signature(el) === sig);
  return at < 0 ? null : at;
}

/* Icons and variants */

function collectPageIcons() {
  const names = new Set();
  liveDoc.querySelectorAll('main p, main div').forEach((el) => {
    if (el.tagName === 'DIV' && el.children.length) return;
    const match = el.textContent.trim().match(ICON_TOKEN);
    if (match) names.add(match[1].toLowerCase());
  });
  liveDoc.querySelectorAll('main span.icon').forEach((el) => {
    classesOf(el).forEach((c) => { if (c.startsWith('icon-')) names.add(c.slice(5)); });
  });
  pageIcons = [...names];
}

function mergeIcons() {
  state.icons = [...new Set([...(state.rules?.icons || []), ...pageIcons, ...siteIcons])].sort();
}

async function loadSiteIcons() {
  try {
    const resp = await fetch(`https://api.github.com/repos/${context.org}/${context.repo}/contents/icons`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!resp.ok) return;
    const list = await resp.json();
    siteIcons = (Array.isArray(list) ? list : [])
      .filter((file) => /\.svg$/i.test(file.name))
      .map((file) => file.name.replace(/\.svg$/i, '').toLowerCase());
    mergeIcons();
    if (state.model) render();
  } catch {
    // Icons from the page and the rules sheet are still offered.
  }
}

function iconUrl(name) {
  if (state.mode === 'demo') return `/tools/blockstudio/demo/icons/${encodeURIComponent(name)}.svg`;
  return `https://main--${context.repo}--${context.org}.aem.live/icons/${encodeURIComponent(name)}.svg`;
}

/**
 * The block library's documentation for a block: the variants authors can choose (a
 * fixed list, with descriptions) and the field names its examples give. Fetched once.
 */
function fetchLibrary(name) {
  if (!settings.libraryBlocks?.length) return null;
  let pending = libraryCache.get(name);
  if (!pending) {
    const hints = hintsFor(blockRules(settings.rules, name, settings.libraryOptions, settings));
    pending = libraryBlock(settings.libraryBlocks, name, libraryFetch, { hints })
      .catch(() => ({ variants: [], examples: [] }))
      .then((lib) => {
        libraryLoaded.set(name, lib);
        return lib;
      });
    libraryCache.set(name, pending);
  }
  return pending;
}

/** A block's rules, with field names from its block library example once loaded. */
function rulesFor(el) {
  const name = blockName(el);
  const rules = blockRules(settings.rules, name, settings.libraryOptions, settings);
  const named = exampleFieldsFor(libraryLoaded.get(name)?.examples, classesOf(el).slice(1));
  rules.itemFields = withLibraryFields(rules.itemFields, named);
  return rules;
}

/**
 * The variants authors can choose come from the block library and the rules sheet.
 * Authors can't add their own. The first time a block opens, its library loads after it
 * and renames its fields.
 */
function loadVariants(name) {
  const known = libraryLoaded.get(name);
  state.libraryVariants = known?.variants.length ? known.variants : settings.variants?.[name] || [];
  const pending = fetchLibrary(name);
  if (!pending || known) return;
  pending.then((lib) => {
    if (state.model?.name !== name) return;
    if (lib.variants.length) state.libraryVariants = lib.variants;
    const named = exampleFieldsFor(lib.examples, state.model.variants);
    if (named.length) {
      state.rules.itemFields = withLibraryFields(state.rules.itemFields, named);
      state.model.schema = state.rules.itemFields;
      derive();
    }
    render();
  });
}

/* Images */

function naturalSize(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({});
      return;
    }
    const img = new Image();
    let done;
    const stop = setTimeout(() => done({}), 8000);
    done = (size) => {
      clearTimeout(stop);
      resolve(size);
    };
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done({});
    img.src = url;
  });
}

async function loadImage(src, info) {
  const abs = previewUrl(src, pageUrl);
  try {
    const url = new URL(abs);
    const local = url.protocol === 'blob:' || url.origin === window.location.origin;
    if (local || /(^|\.)da\.live$/.test(url.hostname)) {
      const resp = await fetcher(abs);
      if (resp.ok) {
        const blob = await resp.blob();
        info.bytes = blob.size;
        if (!local) info.url = URL.createObjectURL(blob);
      }
    } else {
      const resp = await fetch(abs, { method: 'HEAD' });
      const length = Number(resp.headers.get('content-length'));
      if (length) info.bytes = length;
    }
  } catch {
    // The size stays unknown; the image is still shown from its URL.
  }
  Object.assign(info, await naturalSize(info.url), { loading: false });
  if (state.model) {
    derive();
    render();
  }
}

/** What the panel shows for an image: a URL it can display, its size and upload state. */
function imageInfo(src) {
  if (!src) return {};
  let info = images.get(src);
  if (!info) {
    info = { url: previewUrl(src, pageUrl), loading: true };
    images.set(src, info);
    loadImage(src, info);
  }
  return { ...info, uploading: uploading.has(src) };
}

function uploadName(file) {
  const dot = file.name.lastIndexOf('.');
  const rawExt = dot > 0 ? file.name.slice(dot + 1) : (file.type.split('/')[1] || 'png');
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^jpeg$/, 'jpg') || 'png';
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  return `${stem}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
}

/** Stores the file next to the page, where DA keeps a page's images, and returns its URL. */
async function storeImage(file) {
  if (state.mode === 'demo') {
    await wait(600);
    return URL.createObjectURL(file);
  }
  const path = context.path || '/index';
  const cut = path.lastIndexOf('/');
  const folder = path.slice(0, cut);
  const page = path.slice(cut + 1) || 'index';
  const target = `/${context.org}/${context.repo}${folder}/.${page}/${uploadName(file)}`;
  const form = new FormData();
  form.append('data', file, target.split('/').pop());
  const resp = await fetcher(`${DA_ADMIN}/source${target}`, { method: 'PUT', body: form });
  if (!resp.ok) throw new Error(`upload ${resp.status}`);
  return `${DA_CONTENT}${target}`;
}

async function upload(fieldId, file) {
  const hit = state.model && findField(state.model, fieldId);
  if (!hit || !state.editable) return;
  if (!file.type.startsWith('image/')) {
    panel.toast('Pick an image file (PNG, JPEG, GIF, WebP or SVG).');
    return;
  }
  if (file.size > MAX_UPLOAD) {
    panel.toast('That image is over 20 MB. Pick a smaller one.');
    return;
  }
  const oldSrc = hit.field.src;
  uploading.add(oldSrc);
  render();
  try {
    const src = await storeImage(file);
    const preview = URL.createObjectURL(file);
    const info = { url: preview, bytes: file.size, loading: true };
    images.set(src, info);
    naturalSize(preview).then((size) => {
      Object.assign(info, size, { loading: false });
      derive();
      render();
    });
    const now = findField(state.model, fieldId)?.field.src === oldSrc ? fieldId
      : items(state.model).flatMap((row) => row.cells.flatMap((cell) => cell.fields))
        .find((field) => field.type === 'image' && field.src === oldSrc)?.id;
    if (!now) {
      panel.toast('That image was removed while it uploaded.');
      return;
    }
    if (edit({ t: 'set', id: now, props: { src } }, true)) {
      panel.toast('Image replaced. Check its alt text.');
    }
  } catch (error) {
    panel.toast(`The image could not be uploaded (${error.message}). Try again.`);
  } finally {
    uploading.delete(oldSrc);
    render();
  }
}

/** Uploads a picture for an image option (a block background) and sets the option. */
async function uploadOption(key, file, keyText) {
  if (!state.model || !state.editable) return;
  if (!file.type.startsWith('image/')) {
    panel.toast('Pick an image file (PNG, JPEG, GIF, WebP or SVG).');
    return;
  }
  if (file.size > MAX_UPLOAD) {
    panel.toast('That image is over 20 MB. Pick a smaller one.');
    return;
  }
  const busy = `option:${key}`;
  const { name } = state.model;
  const index = state.target?.index;
  uploading.add(busy);
  render();
  try {
    const src = await storeImage(file);
    const preview = URL.createObjectURL(file);
    const info = { url: preview, bytes: file.size, loading: true };
    images.set(src, info);
    naturalSize(preview).then((size) => {
      Object.assign(info, size, { loading: false });
      render();
    });
    // The author may have opened another block while the image uploaded.
    if (state.model?.name !== name || state.target?.index !== index) {
      panel.toast('Another block was opened while the image uploaded. Open the block and choose the image again.');
      return;
    }
    const old = state.view?.options.find((o) => o.key === key);
    edit({
      t: 'option', key, keyText, image: { src, alt: old?.alt || '' },
    }, true);
  } catch (error) {
    panel.toast(`The image could not be uploaded (${error.message}). Try again.`);
  } finally {
    uploading.delete(busy);
    render();
  }
}

/* Following the page */

function readHtml(html) {
  if (typeof html !== 'string' || html === lastHtml) return;
  lastHtml = html;
  liveDoc = parseHtml(html);
  state.blocks = outline(liveDoc);
  collectPageIcons();
  // Load the library for the page's blocks now, so their fields are named when opened.
  new Set(blockElements(liveDoc).map(blockName)).forEach(fetchLibrary);
}

function closeBlock() {
  shelve();
  state.model = null;
  state.target = null;
  state.view = null;
  state.issues = [];
  base = '';
  state.phase = 'empty';
  setStatus('idle');
}

/** Keeps a block's undo history while another block is open. */
function shelve() {
  if (!base || (!undoStack.length && !redoStack.length)) return;
  shelf.delete(base);
  shelf.set(base, { undo: undoStack, redo: redoStack });
  if (shelf.size > SHELF_LIMIT) shelf.delete(shelf.keys().next().value);
}

function openBlock(el, index, same) {
  const name = blockName(el);
  const sig = signature(el);
  if (!same) {
    shelve();
    const saved = shelf.get(sig);
    shelf.delete(sig);
    undoStack = saved?.undo || [];
    redoStack = saved?.redo || [];
    state.open = new Set([1]);
    state.addingOption = '';
    state.showIssues = false;
    state.briefOpen = false;
    state.ai.undo = null;
    setStatus('idle');
  }
  state.rules = rulesFor(el);
  state.model = parseBlock(el, hintsFor(state.rules));
  state.target = { index };
  base = sig;
  state.phase = 'block';
  if (!same) loadVariants(name);
  mergeIcons();
  derive();
  setHistory();
  render();
}

function syncTarget() {
  let index = null;
  if (state.ai.busy && aiSnap) index = aiSnap.index;
  else if (selected != null) index = selected;
  else if (state.target) index = locate(base, state.target.index) ?? state.target.index;
  const el = blockAt(index);
  if (!el) {
    if (state.model || state.phase !== 'empty') closeBlock();
    render();
    return;
  }
  if (state.model && signature(el) === base && blockName(el) === state.model.name) {
    state.target = { index };
    render();
    return;
  }
  const same = !!state.model && state.target?.index === index
    && blockName(el) === state.model.name;
  openBlock(el, index, same);
}

/** With unsaved edits: keep following our block, or say why it cannot be saved yet. */
function followPending() {
  if (!state.model || !state.target) return;
  if (state.status.kind === 'conflict') {
    render();
    return;
  }
  const index = locate(base, state.target.index);
  if (index == null) {
    conflict();
    return;
  }
  state.target = { index };
  if (selected !== index) {
    setStatus('away', `Click the ${blockTitle()} block in the page to save your changes.`, [['Discard', discard]]);
    render();
    return;
  }
  if (state.status.kind === 'away' || state.status.kind === 'error') setStatus('pending', 'Saving…');
  if (!timer && !writing) schedule(150);
  render();
}

function applyLive(update) {
  readHtml(update.html);
  if (typeof update.editable === 'boolean') state.editable = update.editable;
  if (update.selection) selected = update.selection.blockIndex ?? null;
  if (ops.length && state.model) {
    if (state.ai.busy) render();
    else followPending();
    return;
  }
  syncTarget();
}

function onLive(update) {
  if (!update) return;
  if (writing) {
    stash = update;
    return;
  }
  applyLive(update);
}

/* Saving */

function enqueue(task) {
  queue = queue.then(task).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Block Studio', error);
    setStatus('error', 'Something went wrong while saving.', [['Retry', retry, true], ['Discard', discard]]);
    render();
  }).finally(drainStash);
  return queue;
}

function drainStash() {
  if (writing || !stash) return;
  const update = stash;
  stash = null;
  applyLive(update);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    enqueue(doFlush);
  }, ms);
}

function flushNow() {
  clearTimeout(timer);
  timer = null;
  return enqueue(doFlush);
}

async function write(html, index) {
  writing = true;
  let result;
  try {
    result = await host.actions.sendHTML(html, {
      replace: true, expected: { html: lastHtml, blockIndex: index },
    });
  } catch (error) {
    result = { ok: false, error: 'exception', message: error.message };
  }
  if (result?.ok) {
    const fresh = typeof result.html === 'string' ? result.html : stash?.html;
    readHtml(fresh);
    selected = result.selection ? (result.selection.blockIndex ?? null) : index;
    if (typeof result.editable === 'boolean') state.editable = result.editable;
    state.target = { index };
    // Without a fresh copy of the page, what was written is the best guess until EW sends one.
    const el = fresh ? blockAt(index) : null;
    base = el ? signature(el) : signature(html);
  }
  writing = false;
  return result || { ok: false, error: 'unknown' };
}

/** Adds a save to the undo history, merging quick saves of the same fields. */
function record(entry) {
  const last = undoStack[undoStack.length - 1];
  const merge = last && !last.ai && !entry.ai && last.allSet && entry.allSet
    && entry.ids.length && entry.ids.every((id) => last.ids.includes(id))
    && entry.time - last.time < COALESCE_MS && last.afterSig === entry.beforeSig;
  if (merge) {
    last.afterHtml = entry.afterHtml;
    last.afterSig = entry.afterSig;
    last.time = entry.time;
  } else {
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  redoStack = [];
  setHistory();
}

function conflict() {
  clearTimeout(timer);
  timer = null;
  setStatus('conflict', `The ${blockTitle()} block changed in the page while you were editing.`, [
    ['Re-apply my changes', reapply, true], ['Discard mine', discard],
  ]);
  render();
}

function failed(result) {
  const code = result.error;
  if (code === 'STALE_LIVE' && staleTries < STALE_RETRIES) {
    staleTries += 1;
    setStatus('pending', 'Saving…');
    render();
    schedule(400);
    return;
  }
  staleTries = 0;
  if (code === 'STALE_LIVE') {
    conflict();
    return;
  }
  if (code === 'WRONG_SELECTION') {
    followPending();
    return;
  }
  if (result.editable === false) state.editable = false;
  const why = code === 'NO_EDITOR' ? 'the page editor is not ready' : (result.message || code);
  setStatus('error', `Your changes could not be saved: ${why}.`, [['Retry', retry, true], ['Discard', discard]]);
  render();
}

async function doFlush() {
  if (writing || !ops.length || !state.model || !state.target) return;
  if (!state.editable || state.ai.busy) return;
  if (['away', 'conflict'].includes(state.status.kind)) return;
  const { index } = state.target;
  const el = blockAt(index);
  if (!el || signature(el) !== base || selected !== index) {
    followPending();
    return;
  }
  const html = buildBlock(state.model, doc);
  const batch = ops;
  ops = [];
  if (signature(html) === base) {
    setStatus('saved', 'Saved to the page');
    render();
    return;
  }
  const beforeHtml = cleanBlock(el).outerHTML;
  const beforeSig = base;
  setStatus('saving', 'Saving to the page…');
  panel.renderStatus();
  const result = await write(html, index);
  if (!result.ok) {
    ops = [...batch, ...ops];
    failed(result);
    return;
  }
  staleTries = 0;
  const after = blockAt(index);
  record({
    beforeHtml,
    beforeSig,
    afterHtml: after ? cleanBlock(after).outerHTML : html,
    afterSig: base,
    ids: batch.filter((op) => op.t === 'set').map((op) => op.id),
    allSet: batch.every((op) => op.t === 'set'),
    time: Date.now(),
  });
  if (ops.length) {
    setStatus('pending', 'Saving…');
    schedule(150);
    render();
    return;
  }
  setStatus('saved', 'Saved to the page');
  // EW may tidy the HTML; read back what it kept so the form matches the page.
  if (after && signature(html) !== base) openBlock(after, index, true);
  else render();
}

function retry() {
  setStatus('pending', 'Saving…');
  render();
  flushNow();
}

function discard() {
  ops = [];
  clearTimeout(timer);
  timer = null;
  staleTries = 0;
  setStatus('idle');
  const index = selected ?? state.target?.index;
  const el = blockAt(index);
  if (!el) {
    closeBlock();
    render();
    return;
  }
  openBlock(el, index, state.target?.index === index && blockName(el) === state.model?.name);
}

/** Reads the block again as it is in the page and applies the unsaved edits on top. */
function rebase(el, index) {
  state.rules = rulesFor(el);
  const model = parseBlock(el, hintsFor(state.rules));
  applyOps(model, ops, doc);
  state.model = model;
  state.target = { index };
  base = signature(el);
  state.phase = 'block';
  setStatus('pending', 'Saving…');
  derive();
  render();
  schedule(150);
}

function reapply() {
  const els = blockElements(liveDoc);
  const name = state.model?.name;
  const matches = (i) => i != null && els[i] && blockName(els[i]) === name;
  let index = [selected, state.target?.index].find(matches);
  if (index == null) {
    const at = els.findIndex((el) => blockName(el) === name);
    index = at < 0 ? null : at;
  }
  if (index == null) {
    panel.toast(`The ${blockTitle()} block is no longer on the page.`);
    discard();
    return;
  }
  rebase(els[index], index);
}

/* Editing */

function edit(op, commit = true, prepare = null) {
  if (!state.model || !state.editable) return false;
  if (!applyOp(state.model, op, doc)) {
    panel.toast('That part of the block has changed. Try again.');
    return false;
  }
  prepare?.();
  pushOp(ops, op);
  state.ai.undo = null;
  derive();
  if (!['away', 'conflict'].includes(state.status.kind)) setStatus('pending', 'Saving…');
  render();
  schedule(commit ? 150 : 800);
  return true;
}

function setField(id, props, commit = true) {
  const hit = state.model && findField(state.model, id);
  // Leaving an editor without changes must not count as an edit (it would clear "Undo AI change").
  if (hit && Object.entries(props).every(([k, v]) => hit.field[k] === v)) {
    if (commit && timer) schedule(150);
    return true;
  }
  return edit({ t: 'set', id, props }, commit);
}

function addItem({
  from, after, blank, n,
}) {
  seq += 1;
  const id = `n${seq}`;
  const ok = edit({
    t: 'add-item', from, id, blank: !!blank, after,
  }, true, () => {
    const next = new Set([...state.open].map((k) => (k > n ? k + 1 : k)));
    next.add(n + 1);
    state.open = next;
  });
  if (ok) panel.reveal(`row:${id}`);
}

function moveItem(row, by, n) {
  const ok = edit({ t: 'move-item', row, by }, true, () => {
    const a = state.open.has(n);
    const b = state.open.has(n + by);
    state.open.delete(n);
    state.open.delete(n + by);
    if (a) state.open.add(n + by);
    if (b) state.open.add(n);
  });
  if (ok) panel.reveal(`row:${row}`);
}

function deleteItem(row, n) {
  if (items(state.model).length < 2) {
    panel.toast(`A ${state.model.name} block needs at least one ${state.model.noun.toLowerCase()}.`);
    return;
  }
  const group = state.view?.groups.find((g) => g.row.id === row);
  const ok = edit({ t: 'delete-item', row }, true, () => {
    state.open = new Set([...state.open].filter((k) => k !== n).map((k) => (k > n ? k - 1 : k)));
  });
  if (ok) panel.toast(`${group?.title || 'Item'} deleted. Press Undo to bring it back.`);
}

function addField(spec) {
  if (edit({ t: 'add-field', ...spec }, true)) panel.reveal(`${spec.row}.${spec.c}.${spec.at}`);
}

/* Undo and redo */

function step(dir) {
  return enqueue(async () => {
    if (!state.model || !state.target) return;
    if (state.ai.busy) {
      panel.toast('Wait for the assistant to finish first.');
      return;
    }
    clearTimeout(timer);
    timer = null;
    await doFlush();
    if (ops.length) {
      panel.toast('Save or discard your changes first.');
      return;
    }
    const from = dir < 0 ? undoStack : redoStack;
    const entry = from[from.length - 1];
    if (!entry) return;
    if (base !== (dir < 0 ? entry.afterSig : entry.beforeSig)) {
      undoStack = [];
      redoStack = [];
      setHistory();
      render();
      panel.toast('The block was changed in the page, so its undo history was cleared.');
      return;
    }
    const { index } = state.target;
    if (selected !== index) {
      panel.toast(`Click the ${blockTitle()} block in the page first.`);
      return;
    }
    const word = dir < 0 ? 'Undo' : 'Redo';
    setStatus('saving', dir < 0 ? 'Undoing…' : 'Redoing…');
    panel.renderStatus();
    const result = await write(dir < 0 ? entry.beforeHtml : entry.afterHtml, index);
    if (!result.ok) {
      setStatus('error', `${word} did not work: ${result.message || result.error}.`, [['Dismiss', () => {
        setStatus('idle');
        render();
      }]]);
      render();
      return;
    }
    from.pop();
    if (dir < 0) {
      entry.beforeSig = base;
      redoStack.push(entry);
    } else {
      entry.afterSig = base;
      undoStack.push(entry);
    }
    if (entry.ai) state.ai.undo = null;
    setStatus('saved', dir < 0 ? 'Undone' : 'Redone');
    setHistory();
    const el = blockAt(index);
    if (el) openBlock(el, index, true);
    else render();
  });
}

/* AI */

function aiLabel(req) {
  const where = req.where ? ` in ${req.where}` : '';
  if (req.kind === 'brief') return `this ${blockTitle()} block`;
  if (req.kind === 'alt') return `the alt text${where}`;
  return `the ${String(req.label || 'text').toLowerCase()}${where}`;
}

function askAi(req) {
  return enqueue(async () => {
    if (!state.ai.available || state.ai.busy || !state.model || !state.target) return;
    clearTimeout(timer);
    timer = null;
    await doFlush();
    if (ops.length) {
      panel.toast('Save or discard your changes first, then ask again.');
      return;
    }
    const { index } = state.target;
    const el = blockAt(index);
    if (!el) return;
    const block = {
      name: state.model.name,
      number: index + 1,
      lead: el.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || '',
    };
    let prompt;
    if (req.kind === 'brief') {
      prompt = briefPrompt({
        block,
        brief: req.brief,
        noun: state.model.noun,
        count: state.model.mode === 'items' ? items(state.model).length : 1,
        options: options(state.model).map((row) => row.option.keyText),
      });
    } else if (req.kind === 'alt') {
      prompt = altPrompt({ block, where: req.where, alt: req.alt });
    } else {
      prompt = fieldPrompt({ ...req, block });
    }
    const label = aiLabel(req);
    aiSnap = {
      index,
      html: cleanBlock(el).outerHTML,
      sig: signature(el),
      req,
      model: structuredClone(state.model),
      label,
    };
    state.ai = {
      ...state.ai, busy: true, slow: false, label, undo: null,
    };
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      state.ai.slow = true;
      render();
    }, SLOW_AI_MS);
    render();
    try {
      await host.actions.setPrompt(prompt, { autoSend: true });
    } catch (error) {
      aiSnap = null;
      clearTimeout(aiTimer);
      state.ai = { ...state.ai, busy: false, slow: false };
      render();
      panel.toast(`The assistant could not be reached (${error.message}).`);
    }
  });
}

function finishAi(detail) {
  if (!aiSnap) return;
  const snap = aiSnap;
  aiSnap = null;
  clearTimeout(aiTimer);
  state.ai = {
    ...state.ai, busy: false, slow: false, label: '',
  };
  const el = blockAt(snap.index);
  if (el && signature(el) !== snap.sig) {
    record({
      ai: true,
      beforeHtml: snap.html,
      beforeSig: snap.sig,
      afterHtml: cleanBlock(el).outerHTML,
      afterSig: signature(el),
      ids: [],
      allSet: false,
      time: 0,
    });
    state.ai.undo = { label: snap.label };
    if (ops.length) {
      rebase(el, snap.index);
    } else {
      setStatus('saved', 'The assistant\'s change is in the page');
      openBlock(el, snap.index, true);
    }
    return;
  }
  panel.toast(detail?.status === 'completed'
    ? `The assistant finished without changing ${snap.label}.`
    : `The assistant stopped before changing ${snap.label}.`);
  if (ops.length) schedule(150);
  render();
}

function onChatDone(detail) {
  if (!state.ai.busy || !aiSnap) return;
  // The page broadcast that carries the assistant's last edit can trail the event.
  setTimeout(() => finishAi(detail), 400);
}

function undoAi() {
  if (undoStack[undoStack.length - 1]?.ai) step(-1);
  else panel.toast('The assistant\'s change can no longer be undone here.');
}

function setupAi(actions, capabilities) {
  if (typeof actions.setPrompt !== 'function' || capabilities?.chatTurnCompleted !== 1) return;
  try {
    actions.subscribeChatTurnCompleted(onChatDone);
    state.ai.available = true;
  } catch {
    state.ai.available = false;
  }
}

/* Start-up */

function fail(error) {
  // eslint-disable-next-line no-console
  console.error('Block Studio', error);
  state.phase = 'error';
  state.error = error?.message || String(error);
  render(true);
}

async function startLive(sdk) {
  host = sdk;
  const ctx = sdk.context || {};
  context = {
    org: ctx.org,
    repo: ctx.repo || ctx.site,
    path: (ctx.path || '/').replace(/\.html$/, ''),
    ref: ctx.ref,
  };
  token = sdk.token || '';
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) token = e.data.token;
  });
  pageUrl = `https://main--${context.repo}--${context.org}.aem.live${context.path}`;
  const { actions = {}, capabilities = {} } = sdk;
  const supported = capabilities.liveDocument === 1 && capabilities.sendHTMLReplace === 1
    && typeof actions.subscribeLiveDocument === 'function' && typeof actions.sendHTML === 'function';
  if (!supported) {
    state.phase = 'unsupported';
    render(true);
    return;
  }
  settings = await withTimeout(loadSiteSettings(fetcher, {
    org: context.org, site: context.repo, ref: context.ref,
  }), SETTINGS_TIMEOUT, settings);
  state.rulesFound = settings.rules.length > 0;
  setupAi(actions, capabilities);
  loadSiteIcons();
  state.phase = 'empty';
  actions.subscribeLiveDocument(onLive);
  render();
}

function startDemo() {
  state.mode = 'demo';
  const demo = createDemoHost({
    simulate: () => (aiSnap ? {
      index: aiSnap.index, html: cannedEdit(aiSnap.model, aiSnap.req, doc),
    } : null),
  });
  host = demo;
  context = { ...demo.context };
  pageUrl = window.location.href;
  settings = {
    rules: parseRules(DEMO_RULES),
    libraryOptions: parseLibraryOptions(DEMO_LIBRARY.options),
    optionDefs: parseOptionDefs(DEMO_LIBRARY.options),
    itemFields: parseItemFields(DEMO_LIBRARY.fields),
    multiBlocks: parseMultiBlocks(DEMO_LIBRARY.editor),
    variants: DEMO_LIBRARY.variants,
    libraryBlocks: DEMO_LIBRARY.blocks,
    loaded: true,
  };
  libraryFetch = demoLibraryFetch;
  state.rulesFound = true;
  setupAi(demo.actions, demo.capabilities);
  state.phase = 'empty';
  demo.actions.subscribeLiveDocument(onLive);
  render();
}

function tryDemo() {
  const url = new URL(window.location.href);
  url.searchParams.set('demo', '1');
  window.open(url.href, '_blank', 'noopener');
}

function init() {
  panel = createPanel(document.querySelector('.bs-app'), state, {
    undo: () => step(-1),
    redo: () => step(1),
    setField,
    removeField: (id) => edit({ t: 'remove-field', id }, true),
    addField,
    addItem,
    moveItem,
    deleteItem,
    setVariants: (list) => edit({ t: 'variants', list }, true),
    setOption: (key, value, keyText, commit = true) => edit({
      t: 'option', key, value, keyText,
    }, commit),
    removeOption: (key) => edit({ t: 'remove-option', key }, true),
    setOptionImage: (key, props, keyText) => edit({
      t: 'option', key, keyText, image: props,
    }, true),
    uploadOption,
    optionBusy: (key) => uploading.has(`option:${key}`),
    ai: askAi,
    undoAi,
    upload,
    image: imageInfo,
    iconUrl,
    selectBlock: (index) => host?.select?.(index),
    tryDemo,
  });
  render(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ops.length) flushNow();
  });
  const embedded = window.parent !== window && !params.has('demo');
  const sdk = embedded
    ? Promise.race([DA_SDK, wait(SDK_TIMEOUT).then(() => null)])
    : Promise.resolve(null);
  sdk.then((found) => (found?.context?.org ? startLive(found) : startDemo())).catch(fail);
}

init();
