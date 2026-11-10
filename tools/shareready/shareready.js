// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { parseHtml, extractPage, pagePathname } from './lib/extract.js';
import { runChecks } from './lib/checks.js';
import {
  buildProposal, mergeRows, toTableHtml, toPlainText, applyToDocument, selectionInMetadata,
} from './lib/metadata-block.js';
import {
  createFetcher, fetchSource, loadConfig, configFromQuery, loadBulk, bulkFor, findSiteIndex,
  loadImageInfo, siteOrigins,
} from './lib/sources.js';
import {
  DEMO_PAGES, DEMO_HOST, DEMO_BRAND, demoUrl, demoIndexUrl,
} from './lib/demo.js';
import createPanel from './panel.js';

const params = new URLSearchParams(window.location.search);

const SDK_TIMEOUT = 4000;

const state = {
  mode: 'loading',
  sdk: null,
  context: null,
  fetcher: createFetcher(null),
  config: configFromQuery(window.location.search),
  bulk: {},
  index: null,
  indexError: null,
  images: new Map(),
  html: '',
  doc: null,
  page: null,
  result: null,
  proposal: null,
  live: { blockIndex: null, editable: true },
  demo: params.get('page') in DEMO_PAGES ? params.get('page') : 'spring-savings',
  demoFallback: false,
  review: null,
  error: null,
  aiPending: false,
};

const loading = new Map();
let panel;
let analyzeSeq = 0;
let liveTimer;

function pageOptions() {
  if (state.mode === 'demo') {
    return {
      path: DEMO_PAGES[state.demo].path,
      host: DEMO_HOST,
      assetBase: window.location.origin,
      bulk: state.bulk,
    };
  }
  const origins = siteOrigins(state.context);
  return {
    path: state.context.path,
    host: state.config.host || new URL(origins.live).host,
    assetBase: origins.preview,
    bulk: state.bulk,
  };
}

function imageUrls(page) {
  return [page.og.image, page.twitter.image, ...page.images.map((i) => i.url)].filter(Boolean);
}

function ensureImages(urls) {
  return Promise.all([...new Set(urls)].map((url) => {
    if (state.images.has(url)) return null;
    if (!loading.has(url)) {
      loading.set(url, loadImageInfo(url, state.fetcher).then((info) => {
        state.images.set(url, info);
        loading.delete(url);
      }));
    }
    return loading.get(url);
  }));
}

function withSystemChecks(result) {
  if (!state.indexError) return result;
  const checks = [...result.checks];
  const at = checks.findIndex((c) => c.severity === 'pass');
  checks.splice(at < 0 ? checks.length : at, 0, {
    id: 'index-unavailable',
    severity: 'info',
    field: 'index',
    title: 'Duplicate check is off',
    detail: `Couldn't read ${state.indexError.url} (${state.indexError.error}). Publish a query index, or install ShareReady from your own repo so it can read it.`,
  });
  return { ...result, checks, counts: { ...result.counts, info: result.counts.info + 1 } };
}

function analyzePage(doc) {
  const page = extractPage(doc, pageOptions());
  const opts = { images: state.images, index: state.index };
  return { page, result: withSystemChecks(runChecks(page, opts)), opts };
}

/** Recomputes the "after" state of the Fix review from the edited draft values. */
function refreshDraft() {
  if (!state.review || !state.page) return;
  const { draft } = state.review;
  const fields = state.proposal.fields.map((f) => {
    const after = String(draft[f.name] || '').trim();
    const inBlock = state.page.rows.some((r) => r.name === f.name && r.value);
    return {
      ...f, after, changed: !!after && (after !== f.before || !inBlock), missing: !after,
    };
  });
  const proposal = { fields, changed: fields.some((f) => f.changed) };
  const rows = mergeRows(state.page, proposal);
  const doc = applyToDocument(state.doc.cloneNode(true), rows);
  const { page, result } = analyzePage(doc);
  state.review.out = {
    proposal, rows, page, result,
  };
}

async function analyze() {
  if (!state.doc) return;
  analyzeSeq += 1;
  const seq = analyzeSeq;
  const first = extractPage(state.doc, pageOptions());
  await ensureImages(imageUrls(first));
  if (seq !== analyzeSeq) return;
  const { page, result, opts } = analyzePage(state.doc);
  state.page = page;
  state.result = result;
  state.proposal = buildProposal(page, opts);
  state.error = null;
  refreshDraft();
  panel.render();
}

async function reloadSource() {
  panel.setBusy(true);
  try {
    state.html = await fetchSource(state.fetcher, state.context);
    state.doc = parseHtml(state.html);
    await analyze();
  } catch (error) {
    state.error = error;
    panel.render();
  } finally {
    panel.setBusy(false);
  }
}

function onLiveDocument({ html, selection, editable }) {
  state.live = { blockIndex: selection?.blockIndex ?? null, editable: editable !== false };
  if (html === state.html) {
    panel.renderStatus();
    return;
  }
  state.html = html;
  clearTimeout(liveTimer);
  const run = () => {
    state.doc = parseHtml(html);
    analyze();
  };
  if (!state.doc) run();
  else liveTimer = setTimeout(run, 250);
}

async function loadSiteIndex() {
  const { index, error } = await findSiteIndex(state.context, state.config);
  state.index = index;
  state.indexError = error;
  await analyze();
}

async function startLive(sdk) {
  state.sdk = sdk;
  const { context } = sdk;
  state.context = {
    org: context.org,
    repo: context.repo || context.site,
    path: pagePathname(context.path || '/'),
    branch: context.branch || 'main',
  };
  state.fetcher.setToken(sdk.token);
  state.mode = sdk.capabilities?.liveDocument === 1 ? 'ew' : 'da';
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) state.fetcher.setToken(e.data.token);
  });
  panel.render();

  const [config, bulk] = await Promise.all([
    loadConfig(state.fetcher, state.context),
    loadBulk(state.fetcher, state.context),
  ]);
  state.config = { ...config, ...configFromQuery(window.location.search) };
  state.bulk = bulk ? bulkFor(state.context.path, bulk) : {};
  loadSiteIndex();

  if (state.mode === 'ew') {
    sdk.actions.subscribeLiveDocument(onLiveDocument);
    try {
      sdk.actions.subscribeChatTurnCompleted(() => {
        if (!state.aiPending) return;
        state.aiPending = false;
        panel.toast('Assistant finished. ShareReady re-checked the page.');
      });
    } catch {
      // Older hosts have no chat notifications.
    }
  } else {
    await reloadSource();
  }
}

async function loadDemo(name) {
  state.demo = name in DEMO_PAGES ? name : 'spring-savings';
  state.review = null;
  const resp = await fetch(demoUrl(state.demo));
  state.html = await resp.text();
  state.doc = parseHtml(state.html);
  await analyze();
}

async function startDemo(fallback) {
  state.mode = 'demo';
  state.demoFallback = fallback;
  state.config = { brand: DEMO_BRAND, ...state.config };
  try {
    const resp = await fetch(demoIndexUrl());
    state.index = resp.ok ? await resp.json() : null;
  } catch {
    state.index = null;
  }
  await loadDemo(state.demo);
}

/* Actions used by the panel */

function startReview() {
  if (!state.proposal) return;
  const draft = {};
  state.proposal.fields.forEach((f) => { draft[f.name] = f.after || f.before || ''; });
  state.review = {
    draft, altTouched: false, compare: 'after', guide: null,
  };
  refreshDraft();
  panel.render();
}

function updateDraft(name, value) {
  if (!state.review) return;
  state.review.draft[name] = value;
  if (name === 'image-alt') state.review.altTouched = true;
  state.review.guide = null;
  refreshDraft();
  panel.renderResults();
}

function cancelReview() {
  state.review = null;
  panel.render();
}

async function selectionHtml() {
  try {
    return await state.sdk.actions.getSelection();
  } catch {
    return null;
  }
}

function showGuide(id, extra) {
  state.review.guide = { id, extra };
  panel.renderGuide();
}

function finishApply(message) {
  state.review = null;
  panel.render();
  panel.toast(message);
}

async function applyFix() {
  const out = state.review?.out;
  if (!out?.proposal.changed) {
    panel.toast('Nothing to change.');
    return;
  }
  if (state.mode === 'demo') {
    state.doc = applyToDocument(state.doc, out.rows);
    state.html = '';
    finishApply('Metadata block added to the sample page.');
    analyze();
    return;
  }
  if (!state.live.editable) {
    showGuide('read-only');
    return;
  }
  const html = toTableHtml(out.rows);
  if (!state.page.hasMetadataBlock) {
    if (state.mode === 'ew') {
      if (state.live.blockIndex !== null) {
        showGuide('insert-in-block');
        return;
      }
      if (await selectionHtml()) {
        showGuide('insert-selection');
        return;
      }
    }
    state.sdk.actions.sendHTML(html);
    finishApply('Metadata block inserted at your cursor.');
    if (state.mode === 'da') setTimeout(reloadSource, 4000);
    return;
  }
  if (state.mode !== 'ew' || state.sdk.capabilities?.sendHTMLReplace !== 1) {
    showGuide('copy');
    return;
  }
  const selected = await selectionHtml();
  if (state.live.blockIndex !== null || !selectionInMetadata(selected, state.page)) {
    showGuide('select-metadata');
    return;
  }
  const result = await state.sdk.actions.sendHTML(html, { replace: true });
  if (!result?.ok) {
    showGuide('replace-failed', result?.error);
    return;
  }
  finishApply('Metadata block updated.');
}

function copyWithSelection(html) {
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.className = 'sr-copy-holder';
  holder.innerHTML = html;
  document.body.append(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  holder.remove();
  return ok;
}

async function copyTable() {
  const rows = state.review?.out?.rows || mergeRows(state.page, state.proposal);
  const html = toTableHtml(rows);
  const text = toPlainText(rows);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch {
    if (!copyWithSelection(html)) {
      panel.toast('Copy is blocked here. Select the values in the review and copy them by hand.');
      return;
    }
  }
  panel.toast('Metadata table copied. Paste it over the old table.');
}

function aiPrompt() {
  const { page, result } = state;
  const issues = result.checks
    .filter((c) => c.severity === 'error' || c.severity === 'warning')
    .map((c) => `- ${c.title}`);
  const image = page.image.source === 'default' ? 'the best wide image on the page' : page.image.src;
  return [
    `Make this page share-ready. ${page.hasMetadataBlock ? 'Update the existing Metadata table' : 'Add a Metadata table at the end of the page'} with these rows:`,
    '- Title: at most 60 characters, specific, key benefit first, no brand name.',
    '- Description: 120 to 155 characters, unique to this page, with a reason to click.',
    `- Image: ${image} (pick a wider image from the page if this one is not close to 1.91:1).`,
    '- Image Alt: one sentence describing what the image shows.',
    issues.length ? `ShareReady found:\n${issues.join('\n')}` : '',
    'Then, in your reply only (not in the page), draft share copy: a LinkedIn post (2 to 3 short lines and 2 hashtags), an X post under 240 characters and a one-line Slack announcement.',
  ].filter(Boolean).join('\n');
}

function askAi() {
  if (state.mode !== 'ew') {
    panel.toast('Open ShareReady from Experience Workspace to use the assistant.');
    return;
  }
  state.aiPending = true;
  state.sdk.actions.setPrompt(aiPrompt(), { autoSend: true });
  panel.toast('Sent to the assistant. ShareReady re-checks as the page changes.');
}

function refresh() {
  if (state.mode === 'demo') loadDemo(state.demo);
  else if (state.mode === 'da') reloadSource();
  else if (state.mode === 'ew') {
    state.images.clear();
    loadSiteIndex();
  }
}

async function init() {
  panel = createPanel(document.querySelector('main'), state, {
    startReview,
    updateDraft,
    cancelReview,
    applyFix,
    copyTable,
    askAi,
    refresh,
    loadDemo,
    setCompare: (value) => {
      state.review.compare = value;
      panel.renderResults();
    },
  }, { demoPages: DEMO_PAGES });
  panel.render();
  const embedded = window.parent !== window && !params.has('demo');
  const sdk = embedded
    ? await Promise.race([
      DA_SDK,
      new Promise((resolve) => { setTimeout(() => resolve(null), SDK_TIMEOUT); }),
    ])
    : null;
  if (sdk?.context?.org) {
    await startLive(sdk);
  } else {
    await startDemo(embedded || !params.has('demo'));
  }
}

init();
