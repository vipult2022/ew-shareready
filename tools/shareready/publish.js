// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { h, clear } from './lib/dom.js';
import { parseHtml, extractPage, pagePathname } from './lib/extract.js';
import { runChecks, platformIssues } from './lib/checks.js';
import { renderPreview } from './lib/previews.js';
import {
  createFetcher, fetchSource, loadConfig, configFromQuery, loadBulk, bulkFor, findSiteIndex,
  loadImageInfo, siteOrigins,
} from './lib/sources.js';
import {
  docPath, webPath, getStatus, describeStatus, publishPage, withUtm, utmFor, campaignFor,
  shareLinks, linkedinInspector, workerStatus, workerShare,
} from './lib/aem.js';
import {
  plural, verdict, worst, ring, fitFrames,
} from './lib/ui.js';
import {
  DEMO_PAGES, DEMO_HOST, DEMO_BRAND, demoUrl, demoIndexUrl,
} from './lib/demo.js';

const params = new URLSearchParams(window.location.search);
const SDK_TIMEOUT = 4000;
const REPO_URL = 'https://github.com/vipult2022/ew-shareready';
const WORKER_DOCS = `${REPO_URL}#set-up-the-worker`;
const PUBLISH_SETTLE = 1500;

const PREVIEWS = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'teams', label: 'Teams' },
  { id: 'slack-post', label: 'Slack post' },
];

const WORKER_STEPS = ['facebook', 'indexnow', 'slack'];

const NOT_SET_UP = {
  facebook: 'Not set up on the worker yet (META_APP_ID and META_APP_SECRET).',
  indexnow: 'Not set up on the worker yet (INDEXNOW_KEY).',
  slack: 'Not set up on the worker yet (SLACK_WEBHOOK_URL).',
};

const RUNNING = {
  publish: 'Publishing…',
  facebook: 'Asking Facebook to read the page again…',
  indexnow: 'Notifying search engines…',
  slack: 'Posting…',
};

const DEMO_LATENCY = {
  publish: 1100, facebook: 1500, indexnow: 700, slack: 1000,
};

const state = {
  mode: 'loading',
  sdk: null,
  context: null,
  fetcher: createFetcher(null),
  config: configFromQuery(window.location.search),
  bulk: {},
  index: null,
  images: new Map(),
  page: null,
  result: null,
  error: null,
  status: { state: 'checking' },
  worker: { state: 'off' },
  selected: {
    publish: true, facebook: true, indexnow: true, slack: true,
  },
  note: '',
  platform: 'linkedin',
  run: null,
  nextStatus: null,
  demo: params.get('page') in DEMO_PAGES ? params.get('page') : 'everyday-checking',
};

const els = {};
/* Filled in at the end of the file, so event handlers can call functions defined later. */
const view = {};
const actions = {};
let toastTimer;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* Page and site facts */

function pagePath() {
  return state.mode === 'demo' ? DEMO_PAGES[state.demo].path : state.context.path;
}

function shareHost() {
  if (state.mode === 'demo') return DEMO_HOST;
  return state.config.host || new URL(siteOrigins(state.context).live).host;
}

function pageUrl() {
  return `https://${shareHost()}${webPath(pagePath())}`;
}

function channel() {
  const name = state.config['slack-channel'] || state.worker.features?.slackChannel || '';
  return name || 'Slack';
}

function ago(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const minutes = Math.round((Date.now() - t) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return plural(days, 'day').concat(' ago');
  return new Date(t).toLocaleDateString();
}

/* Steps */

function stepAvailable(id) {
  if (id === 'publish') return true;
  return state.worker.state === 'ok' && !!state.worker.features?.[id];
}

function stepReason(id) {
  if (id === 'publish' || stepAvailable(id)) return '';
  if (state.worker.state === 'checking') return 'Connecting to the ShareReady worker…';
  if (state.worker.state === 'ok') return NOT_SET_UP[id];
  return 'Needs the ShareReady worker.';
}

function chosen() {
  return ['publish', ...WORKER_STEPS].filter((id) => state.selected[id] && stepAvailable(id));
}

function primaryLabel(ids) {
  const publish = ids.includes('publish');
  const others = ids.length - (publish ? 1 : 0);
  if (publish && others) return 'Publish & share';
  if (publish) return 'Publish';
  if (others) return 'Share';
  return 'Get share links';
}

function publishStatusText() {
  const { status } = state;
  if (status.state === 'checking') return 'Checking what’s live…';
  if (status.state === 'unpublished') return 'Not live yet.';
  if (status.state === 'changed') {
    const when = ago(status.lastPublished);
    return `The draft has changes that aren’t live${when ? ` (last published ${when})` : ''}.`;
  }
  if (status.state === 'live') {
    const when = ago(status.lastPublished);
    return `Live is up to date${when ? `, published ${when}` : ''}.`;
  }
  return status.error || 'Couldn’t check what’s live. Publishing is still safe.';
}

/* Rendering helpers */

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('sr-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('sr-show'), 4500);
}

function previewOptions(page) {
  const opts = {
    src: (url) => state.images.get(url)?.display || url,
    brand: state.config.brand || page.og.siteName || page.host,
    shareUrl: pageUrl(),
  };
  if (state.note.trim()) opts.postText = state.note.trim();
  if (state.config['x-handle']) opts.handle = state.config['x-handle'].replace(/^@/, '');
  return opts;
}

/** What the worker's Slack message will look like (Block Kit: card, note, buttons). */
function slackPost(page) {
  const opts = previewOptions(page);
  const link = withUtm(pageUrl(), utmFor('slack', state.config, pagePath()));
  const image = page.og.image ? opts.src(page.og.image) : '';
  return h(
    'div',
    { class: 'sr-frame sr-pub-slack', style: { width: '520px' } },
    h('div', { class: 'sr-pub-slack-avatar', 'aria-hidden': 'true' }, 'SR'),
    h(
      'div',
      { class: 'sr-pub-slack-body' },
      h(
        'div',
        { class: 'sr-pub-slack-meta' },
        h('strong', {}, 'ShareReady'),
        h('span', { class: 'sr-pub-slack-app' }, 'APP'),
        h('span', {}, 'now'),
        h('span', { class: 'sr-pub-slack-channel' }, `in ${channel()}`),
      ),
      h('a', { class: 'sr-pub-slack-title', href: link, tabindex: '-1' }, page.og.title || link),
      page.og.description ? h('p', {}, page.og.description) : null,
      image ? h('img', { src: image, alt: page.og.imageAlt || '' }) : null,
      state.note.trim() ? h('blockquote', {}, state.note.trim()) : null,
      h(
        'div',
        { class: 'sr-pub-slack-buttons' },
        h('span', { class: 'sr-pub-slack-primary' }, 'Open page'),
        h('span', {}, 'Edit in EW'),
      ),
      h('p', { class: 'sr-pub-slack-context' }, `Shared with ShareReady from Experience Workspace · ${shareHost()}`),
    ),
  );
}

function renderStage() {
  const { page, result } = state;
  if (state.platform === 'slack-post') return slackPost(page);
  const layout = result.layouts.find((l) => l.platform.id === state.platform);
  const issues = platformIssues(result.checks, state.platform);
  return renderPreview(layout, page, {
    ...previewOptions(page),
    flagged: new Set(issues.map((c) => c.field)),
  });
}

function platformChips() {
  const { result } = state;
  return h(
    'div',
    { class: 'sr-chips', role: 'tablist', 'aria-label': 'Preview' },
    PREVIEWS.map((p) => {
      const id = p.id === 'slack-post' ? 'slack' : p.id;
      const tone = worst(platformIssues(result.checks, id));
      return h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'sr-chip',
          'aria-selected': String(state.platform === p.id),
          onclick: () => {
            state.platform = p.id;
            view.preview();
          },
        },
        h('span', { class: `sr-dot sr-tone-${tone}`, 'aria-hidden': 'true' }),
        p.label,
      );
    }),
  );
}

function topIssues() {
  const issues = state.result.checks.filter((c) => c.severity === 'error' || c.severity === 'warning');
  if (!issues.length) {
    return h('p', { class: 'sr-pub-clean' }, '✓ No problems found. This page will look right wherever it’s shared.');
  }
  const shown = issues.slice(0, 3);
  return h(
    'div',
    { class: 'sr-pub-issues' },
    h('ul', { class: 'sr-issues' }, shown.map((c) => h('li', { class: `sr-tone-${c.severity}` }, c.title))),
    h(
      'p',
      { class: 'sr-pub-hint' },
      issues.length > shown.length ? `And ${plural(issues.length - shown.length, 'more issue')}. ` : '',
      'Fix them with ShareReady in the Library, then come back here.',
    ),
  );
}

function renderPreviewColumn() {
  const col = els.preview;
  clear(col);
  if (state.error) {
    const tips = {
      401: 'Your sign-in may have expired. Reload Experience Workspace and try again.',
      403: 'You don’t have access to read this page.',
      404: 'There’s no saved draft for this page yet.',
    };
    col.append(h(
      'div',
      { class: 'sr-state sr-state-error' },
      h('h3', {}, 'Couldn’t read this page'),
      h('p', {}, tips[state.error.status] || state.error.message || String(state.error)),
      h('button', { type: 'button', class: 'sr-btn', onclick: () => actions.readPage() }, 'Try again'),
    ));
    return;
  }
  if (!state.result) {
    col.append(h('div', { class: 'sr-state' }, h('span', { class: 'sr-loader', role: 'status', 'aria-label': 'Reading the page' })));
    return;
  }
  const v = verdict(state.result);
  const { counts } = state.result;
  const found = [
    counts.error ? plural(counts.error, 'problem') : '',
    counts.warning ? plural(counts.warning, 'warning') : '',
  ].filter(Boolean).join(' and ');
  col.append(
    h(
      'div',
      { class: 'sr-pub-head' },
      ring(state.result.score, v.tone),
      h(
        'div',
        {},
        h('h2', { class: `sr-tone-${v.tone}` }, v.label),
        h('p', {}, found ? `ShareReady found ${found}.` : 'Every check passed.'),
      ),
    ),
    platformChips(),
    h('div', { class: 'sr-stage sr-pub-stage' }, renderStage()),
    topIssues(),
  );
  fitFrames(col);
}

function stepIcon(step) {
  const result = state.run?.steps[step];
  if (result) return h('span', { class: `sr-pub-icon sr-pub-${result.state}`, 'aria-hidden': 'true' });
  return null;
}

function stepResult(id) {
  const result = state.run?.steps[id];
  if (!result?.message) return null;
  return h(
    'p',
    { class: `sr-pub-result sr-pub-result-${result.state}` },
    result.message,
    result.link ? [' ', h('a', { href: result.link.href, target: '_blank', rel: 'noopener' }, result.link.label)] : null,
  );
}

function stepRow(id, title, detail, extra) {
  const available = stepAvailable(id);
  const locked = !!state.run;
  const reason = stepReason(id);
  const inputId = `sr-step-${id}`;
  return h(
    'li',
    { class: `sr-pub-step${available ? '' : ' sr-pub-off'}` },
    h('input', {
      type: 'checkbox',
      id: inputId,
      checked: state.selected[id] && available,
      disabled: !available || locked,
      onchange: (e) => {
        state.selected[id] = e.target.checked;
        view.steps();
      },
    }),
    h(
      'div',
      { class: 'sr-pub-step-body' },
      h('label', { for: inputId }, title, stepIcon(id)),
      h('p', {}, reason || detail),
      stepResult(id),
      available ? extra : null,
    ),
  );
}

function slackExtra() {
  const link = withUtm(pageUrl(), utmFor('slack', state.config, pagePath()));
  return h(
    'div',
    { class: 'sr-pub-note' },
    h('textarea', {
      id: 'sr-note',
      rows: '2',
      maxlength: '500',
      placeholder: 'Add a note for the team (optional)',
      'aria-label': 'Note for the Slack post',
      disabled: !!state.run,
      onfocus: () => {
        if (state.platform === 'slack-post') return;
        state.platform = 'slack-post';
        view.preview();
      },
      oninput: (e) => {
        state.note = e.target.value;
        if (state.result) view.preview();
      },
    }, state.note),
    h('p', { class: 'sr-pub-utm' }, h('span', {}, 'Link: '), h('code', {}, link)),
  );
}

function workerNotice() {
  const { worker } = state;
  if (worker.state === 'ok' || worker.state === 'checking') return null;
  const text = worker.state === 'error'
    ? `The ShareReady worker isn’t answering: ${worker.error}`
    : 'Facebook, search engines and Slack need the ShareReady worker, which keeps their keys off the page. Publishing and share links work without it.';
  return h(
    'div',
    { class: 'sr-pub-notice' },
    h('p', {}, text),
    h('a', { href: WORKER_DOCS, target: '_blank', rel: 'noopener' }, 'Set up the worker (about 10 minutes)'),
  );
}

function copyText(text) {
  const area = h('textarea', { class: 'sr-copy-holder', readonly: true }, text);
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

async function copyLink(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied.');
  } catch {
    toast(copyText(text) ? 'Link copied.' : 'Copy is blocked here. Select the link and copy it.');
  }
}

function doneSummary() {
  const states = Object.values(state.run.steps).map((s) => s.state);
  const failed = states.filter((s) => s === 'error' || s === 'blocked').length;
  if (states.includes('error') && state.run.steps.publish?.state === 'error') {
    return { tone: 'error', title: 'Not published', text: 'Nothing was shared. Fix the problem above and try again.' };
  }
  if (failed) {
    return { tone: 'warning', title: `Done, with ${plural(failed, 'problem')}`, text: 'The rest went through. Share it yourself:' };
  }
  const live = state.status.state === 'live' || state.run.steps.publish?.state === 'ok';
  return {
    tone: 'pass',
    title: live ? 'Live and ready to share' : 'Ready to share',
    text: 'Share it yourself, with tracking tags already added:',
  };
}

function shareBlock() {
  const url = pageUrl();
  const summary = doneSummary();
  const title = state.page?.og.title || '';
  const links = shareLinks(url, { title, config: state.config, path: pagePath() });
  const blocked = summary.tone === 'error';
  return h(
    'section',
    { class: `sr-pub-done sr-tone-${summary.tone}`, 'aria-live': 'polite' },
    h('h3', {}, summary.title),
    h('p', {}, summary.text),
    blocked ? null : [
      h(
        'div',
        { class: 'sr-pub-link' },
        h('input', {
          type: 'text', readonly: true, value: url, 'aria-label': 'Page link', onfocus: (e) => e.target.select(),
        }),
        h('button', { type: 'button', class: 'sr-btn', onclick: () => copyLink(url) }, 'Copy link'),
      ),
      h('div', { class: 'sr-pub-share' }, links.map((l) => h('a', {
        class: `sr-btn sr-pub-net sr-pub-net-${l.id}`, href: l.href, target: '_blank', rel: 'noopener',
      }, l.label))),
      h('p', { class: 'sr-pub-utm' }, `Tagged utm_medium=${utmFor('linkedin', state.config, pagePath()).medium} and utm_campaign=${campaignFor(state.config, pagePath())}.`),
    ],
  );
}

function renderSteps() {
  const focused = document.activeElement?.id;
  const col = els.steps;
  clear(col);
  const ids = chosen();
  const running = state.run?.phase === 'running';
  const { status } = state;
  const errors = state.result?.counts.error || 0;
  const warnUnpublished = !state.selected.publish && status.state === 'unpublished'
    && ids.some((id) => id !== 'publish');

  col.append(
    h('h2', { class: 'sr-pub-title' }, 'Publish and share this page'),
    h('p', { class: 'sr-pub-url' }, h('a', { href: pageUrl(), target: '_blank', rel: 'noopener' }, pageUrl())),
    h(
      'ol',
      { class: 'sr-pub-steps' },
      stepRow('publish', status.publish === false ? 'Publish again' : 'Publish the page', publishStatusText()),
      stepRow('facebook', 'Refresh the Facebook preview', 'Facebook keeps old cards for weeks. This makes it read the new title, text and image now.'),
      stepRow('indexnow', 'Tell search engines', 'Pings IndexNow (Bing, Yandex, Naver and others) so the page is crawled again soon.'),
      stepRow('slack', `Post to ${channel()}`, 'Posts the card with a tracked link and an Edit in EW button.', slackExtra()),
      h(
        'li',
        { class: 'sr-pub-step sr-pub-manual' },
        h('span', { class: 'sr-pub-manual-mark', 'aria-hidden': 'true' }, 'in'),
        h(
          'div',
          { class: 'sr-pub-step-body' },
          h('strong', {}, 'Refresh the LinkedIn preview'),
          h('p', {}, 'LinkedIn keeps cards for 7 days and has no API for this. Open Post Inspector after publishing.'),
          h('a', {
            class: 'sr-link', href: linkedinInspector(pageUrl()), target: '_blank', rel: 'noopener',
          }, 'Open LinkedIn Post Inspector'),
        ),
      ),
    ),
  );
  const notice = workerNotice();
  if (notice) col.append(notice);

  if (state.run?.phase === 'done') {
    col.append(shareBlock());
  }

  const warnings = [];
  if (!state.run && errors) {
    warnings.push(h('p', { class: 'sr-pub-warn sr-tone-error' }, `${plural(errors, 'problem')} will show in shares. Fix them first, or share anyway.`));
  }
  if (!state.run && warnUnpublished) {
    warnings.push(h('p', { class: 'sr-pub-warn sr-tone-warning' }, 'The page isn’t live yet, so Facebook and Slack would show an error page. Keep Publish ticked.'));
  }

  col.append(h(
    'div',
    { class: 'sr-pub-actions' },
    warnings,
    state.run?.phase === 'done'
      ? h('button', { type: 'button', class: 'sr-btn', onclick: actions.reset }, 'Start over')
      : h(
        'button',
        {
          type: 'button',
          class: 'sr-btn sr-primary sr-pub-go',
          disabled: running || state.status.state === 'checking',
          onclick: actions.share,
        },
        running ? [h('span', { class: 'sr-pub-spin', 'aria-hidden': 'true' }), 'Working…'] : primaryLabel(ids),
      ),
  ));

  if (focused) document.getElementById(focused)?.focus();
}

function renderBanner() {
  clear(els.banner);
  if (state.mode !== 'demo') return;
  els.banner.append(h(
    'div',
    { class: 'sr-demo sr-pub-demo' },
    h('p', {}, h('strong', {}, 'Demo. '), 'Nothing is published or posted. Open Publish & Share from Experience Workspace to share a real page.'),
    h(
      'span',
      { class: 'sr-pub-demo-pick' },
      h('label', { for: 'sr-demo-page' }, 'Page'),
      h('select', {
        id: 'sr-demo-page',
        onchange: (e) => actions.loadDemo(e.target.value),
      }, Object.entries(DEMO_PAGES).map(([name, p]) => h('option', { value: name, selected: name === state.demo }, p.label))),
    ),
  ));
}

function render() {
  renderBanner();
  renderPreviewColumn();
  renderSteps();
}

/* Actions */

function setStep(id, value) {
  state.run.steps[id] = value;
  renderSteps();
}

function workerBody(id) {
  const { page } = state;
  return {
    org: state.context.org,
    site: state.context.repo,
    path: docPath(state.context.path),
    host: shareHost(),
    steps: [id],
    utm: utmFor('slack', state.config, pagePath()),
    note: state.note.trim(),
    card: page ? {
      title: page.og.title,
      description: page.og.description,
      image: page.og.image,
      imageAlt: page.og.imageAlt,
    } : {},
  };
}

function fromWorker(id, res) {
  const r = res?.results?.[id];
  if (!r) return { state: 'error', message: res?.error || 'The worker didn’t answer.' };
  if (r.skipped) return { state: 'skipped', message: r.message };
  const link = id === 'facebook' && r.debugger ? { href: r.debugger, label: 'Open Sharing Debugger' } : null;
  return { state: r.ok ? 'ok' : 'error', message: r.message, link };
}

async function demoStep(id) {
  await wait(DEMO_LATENCY[id]);
  const messages = {
    publish: `Published to ${DEMO_HOST}.`,
    facebook: 'Facebook refreshed its preview.',
    indexnow: 'IndexNow accepted the URL.',
    slack: `Posted to ${channel()}.`,
  };
  return { state: 'ok', message: messages[id] };
}

async function runPublish() {
  setStep('publish', { state: 'running', message: RUNNING.publish });
  const res = state.mode === 'demo'
    ? { ok: true, url: `https://${DEMO_HOST}${webPath(DEMO_PAGES[state.demo].path)}` }
    : await publishPage(state.fetcher, state.context);
  if (!res.ok) {
    setStep('publish', { state: 'error', message: res.error });
    return false;
  }
  if (state.mode === 'demo') {
    setStep('publish', await demoStep('publish'));
  } else {
    setStep('publish', {
      state: 'ok',
      message: 'Published.',
      link: res.url ? { href: res.url, label: 'View live page' } : null,
    });
  }
  // Shown after "Start over", so the finished run keeps describing the page as it was.
  state.nextStatus = {
    state: 'live', publish: false, lastPublished: new Date().toISOString(), liveUrl: res.url,
  };
  return true;
}

async function runWorkerStep(id) {
  const message = id === 'slack' ? `Posting to ${channel()}…` : RUNNING[id];
  setStep(id, { state: 'running', message });
  const res = state.mode === 'demo'
    ? await demoStep(id)
    : fromWorker(id, await workerShare(state.config['worker-url'], state.fetcher.token, workerBody(id)));
  setStep(id, res);
}

async function share() {
  const ids = chosen();
  const others = ids.filter((id) => id !== 'publish');
  state.run = { phase: 'running', steps: {} };
  ids.forEach((id) => { state.run.steps[id] = { state: 'waiting', message: '' }; });
  renderSteps();

  if (ids.includes('publish')) {
    const ok = await runPublish();
    if (!ok) {
      others.forEach((id) => {
        state.run.steps[id] = { state: 'blocked', message: 'Not run, because publishing failed.' };
      });
      state.run.phase = 'done';
      renderSteps();
      return;
    }
    if (others.length && state.mode !== 'demo') await wait(PUBLISH_SETTLE);
  }
  await Promise.all(others.map(runWorkerStep));
  state.run.phase = 'done';
  renderSteps();
  const failed = Object.values(state.run.steps).filter((s) => s.state === 'error').length;
  toast(failed ? `Done, but ${plural(failed, 'step')} failed.` : 'All done.');
}

function reset() {
  state.run = null;
  if (state.nextStatus) {
    state.status = state.nextStatus;
    state.selected.publish = false;
    state.nextStatus = null;
  }
  renderSteps();
}

/* Loading */

function imageUrls(page) {
  return [page.og.image, page.twitter.image, ...page.images.map((i) => i.url)].filter(Boolean);
}

async function analyze(html, options) {
  const doc = parseHtml(html);
  const first = extractPage(doc, options);
  await Promise.all([...new Set(imageUrls(first))].map(async (url) => {
    if (!state.images.has(url)) state.images.set(url, await loadImageInfo(url, state.fetcher));
  }));
  state.page = extractPage(doc, options);
  state.result = runChecks(state.page, { images: state.images, index: state.index });
  state.error = null;
}

async function readPage() {
  state.error = null;
  state.result = null;
  renderPreviewColumn();
  const origins = siteOrigins(state.context);
  try {
    const html = await fetchSource(state.fetcher, state.context);
    await analyze(html, {
      path: state.context.path,
      host: shareHost(),
      assetBase: origins.preview,
      bulk: state.bulk,
    });
  } catch (error) {
    state.error = error;
  }
  renderPreviewColumn();
  renderSteps();
}

async function checkStatus() {
  const status = await getStatus(state.fetcher, state.context);
  state.status = status.ok ? describeStatus(status) : { state: 'unknown', publish: true, error: status.error };
  state.selected.publish = state.status.publish;
  renderSteps();
}

async function checkWorker() {
  const url = state.config['worker-url'];
  if (!url) {
    state.worker = { state: 'off' };
    return;
  }
  state.worker = { state: 'checking' };
  renderSteps();
  const res = await workerStatus(url);
  state.worker = res.ok ? { state: 'ok', features: res.features } : { state: 'error', error: res.error };
  renderSteps();
}

async function startLive(sdk) {
  state.mode = 'live';
  state.sdk = sdk;
  const { context } = sdk;
  state.context = {
    org: context.org,
    repo: context.repo || context.site,
    path: pagePathname(context.path || '/'),
    branch: context.branch || 'main',
  };
  state.fetcher.setToken(sdk.token);
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.token) state.fetcher.setToken(e.data.token);
  });
  render();

  const [config, bulk] = await Promise.all([
    loadConfig(state.fetcher, state.context),
    loadBulk(state.fetcher, state.context),
  ]);
  state.config = { ...config, ...configFromQuery(window.location.search) };
  state.bulk = bulk ? bulkFor(state.context.path, bulk) : {};
  renderSteps();
  const { index } = await findSiteIndex(state.context, state.config);
  state.index = index;
  await Promise.all([readPage(), checkStatus(), checkWorker()]);
}

async function loadDemo(name) {
  state.demo = name in DEMO_PAGES ? name : 'everyday-checking';
  state.run = null;
  state.nextStatus = null;
  state.result = null;
  clearTimeout(toastTimer);
  els.toast.classList.remove('sr-show');
  render();
  els.preview.scrollTop = 0;
  els.steps.scrollTop = 0;
  const resp = await fetch(demoUrl(state.demo));
  await analyze(await resp.text(), {
    path: DEMO_PAGES[state.demo].path,
    host: DEMO_HOST,
    assetBase: window.location.origin,
    bulk: {},
  });
  state.status = state.demo === 'spring-savings'
    ? { state: 'unpublished', publish: true }
    : {
      state: 'changed', publish: true, lastPublished: new Date(Date.now() - 3 * 86400000).toISOString(),
    };
  state.selected.publish = true;
  render();
}

async function startDemo() {
  state.mode = 'demo';
  state.config = { brand: DEMO_BRAND, 'slack-channel': '#campaigns', ...state.config };
  state.worker = {
    state: 'ok',
    features: {
      facebook: true, indexnow: true, slack: true, slackChannel: '#campaigns',
    },
  };
  try {
    const resp = await fetch(demoIndexUrl());
    state.index = resp.ok ? await resp.json() : null;
  } catch {
    state.index = null;
  }
  await loadDemo(state.demo);
}

async function init() {
  const root = document.querySelector('main');
  els.banner = h('div', { class: 'sr-pub-banner' });
  els.preview = h('section', { class: 'sr-pub-preview', 'aria-label': 'How the page will look' });
  els.steps = h('section', { class: 'sr-pub-panel', 'aria-label': 'Publish and share' });
  els.toast = h('div', { class: 'sr-toast', role: 'status', 'aria-live': 'polite' });
  root.append(els.banner, h('div', { class: 'sr-pub-grid' }, els.preview, els.steps), els.toast);
  els.preview.append(h('div', { class: 'sr-state' }, h('span', { class: 'sr-loader', role: 'status', 'aria-label': 'Loading' })));
  window.addEventListener('resize', () => fitFrames(els.preview));

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
    await startDemo();
  }
}

Object.assign(view, { preview: renderPreviewColumn, steps: renderSteps });
Object.assign(actions, {
  share, reset, readPage, loadDemo,
});

init();
