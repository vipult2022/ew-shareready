import { h, clear } from './lib/dom.js';
import { compare, titleOf } from './lib/page.js';
import { publishedComment } from './lib/adf.js';
import {
  changeList, statusChip, summarize, loader, notice, plural, ago, STATES,
} from './lib/view.js';
import { startSession, closeDialog, DOCS_URL } from './lib/session.js';

const state = {
  session: null,
  loading: true,
  error: '',
  setup: false,
  review: null,
  compared: null,
  confirmed: false,
  publishing: false,
  publishError: '',
  result: null,
};

const els = {};
const actions = {};

function open(review) {
  return review && review.state !== 'done';
}

function pageTitle() {
  return titleOf(state.compared?.units || [], state.session.page.webPath);
}

/**
 * Where this page stands before publishing:
 * approved (clean), edited (approved, then changed), pending (not approved yet),
 * none (no open review) or same (nothing to publish).
 */
function gate() {
  const { review, compared } = state;
  const edits = compared.sinceReview || [];
  if (open(review)) {
    if (review.state === 'approved') return edits.length ? 'edited' : 'approved';
    return 'pending';
  }
  if (!compared.firstVersion && !compared.sinceLive.length) return 'same';
  return 'none';
}

function needsConfirm(g) {
  return ['edited', 'pending', 'none'].includes(g);
}

function blocked(g) {
  return needsConfirm(g) && state.session.config.requireApproval;
}

/* Left: what would go live */

function gateNotice(g) {
  const { review, compared } = state;
  const edits = compared.sinceReview || [];
  if (g === 'approved') {
    return notice('pass', 'Approved: ready to publish', h('p', {}, `${review.approvedBy || 'The reviewer'} approved round ${review.round || 1}${review.approvedAt ? ` ${ago(review.approvedAt)}` : ''}. Nothing changed since.`));
  }
  if (g === 'edited') {
    return notice('warning', 'Edited after approval', h('p', {}, `${plural(edits.length, 'change')} since ${review.approvedBy || 'the reviewer'} approved. These have not been reviewed.`));
  }
  if (g === 'pending') {
    return notice('warning', `Not approved yet: ${(STATES[review.state]?.label || review.status || 'In review').toLowerCase()}`, h('p', {}, `${review.key} is waiting for ${review.assignee?.name || 'the reviewer'}.`));
  }
  if (g === 'same') {
    return notice('info', 'Nothing new to publish', h('p', {}, 'The draft matches the live page.'));
  }
  return notice('info', 'Not reviewed', h('p', {}, compared.firstVersion
    ? 'This page has never been published and has no review.'
    : `${summarize(compared.sinceLive)} since live, and no review was requested.`));
}

function renderLeft() {
  const root = clear(els.left);
  if (state.loading) {
    root.append(loader('Checking the review'), h('p', { class: 'rl-muted rl-center' }, 'Checking the Jira review and comparing the draft with live…'));
    return;
  }
  if (state.error) return;
  const g = gate();
  root.append(gateNotice(g));
  const { compared } = state;
  const edits = compared.sinceReview || [];
  if (g === 'edited' || (g === 'pending' && edits.length)) {
    root.append(
      h('p', { class: 'rl-lede' }, g === 'edited' ? 'Not reviewed:' : `${summarize(edits)} since it was sent for review.`),
      changeList(edits, 'Nothing changed since it was sent.'),
    );
  }
  root.append(
    h('p', { class: 'rl-lede rl-spaced' }, compared.firstVersion ? 'Going live for the first time.' : `What goes live: ${summarize(compared.sinceLive).toLowerCase()}.`),
    compared.firstVersion ? null : changeList(compared.sinceLive, 'The draft matches the live page.'),
  );
}

/* Right: publish */

function reviewCard(review) {
  return h(
    'div',
    { class: 'rl-review-card' },
    h('div', { class: 'rl-review-row' }, h('a', {
      href: review.url, target: '_blank', rel: 'noopener', class: 'rl-key',
    }, review.key), statusChip(review)),
    h('p', { class: 'rl-muted' }, [
      review.reviewType ? `${review.reviewType} review` : 'Review',
      review.assignee?.name,
      `round ${review.round || 1}`,
    ].filter(Boolean).join(' · ')),
  );
}

function confirmText(g) {
  if (g === 'edited') return 'Publish the unreviewed changes anyway. Jira will record it.';
  if (g === 'pending') return 'Publish before approval. Jira will record it.';
  return 'This change does not need a review. Publish without one.';
}

function resultView() {
  const { result } = state;
  return h(
    'div',
    { class: 'rl-result' },
    h('div', { class: 'rl-result-icon', 'aria-hidden': 'true' }, '✓'),
    h('h2', {}, result.demo ? 'Published (demo)' : 'Published'),
    h('p', {}, h('a', { href: result.url, target: '_blank', rel: 'noopener' }, result.url)),
    result.key && result.jiraOk ? h('p', { class: 'rl-muted' }, `${result.key} is closed with a link to the live page.`) : null,
    result.key && !result.jiraOk ? notice('warning', `${result.key} was not updated`, h('p', {}, result.jiraError)) : null,
    h(
      'div',
      { class: 'rl-actions' },
      h('a', {
        class: 'rl-btn rl-btn-primary', href: result.url, target: '_blank', rel: 'noopener',
      }, 'View live page'),
      result.key ? h('a', {
        class: 'rl-btn', href: state.review.url, target: '_blank', rel: 'noopener',
      }, `Open ${result.key}`) : null,
      state.session.sdk ? h('button', { type: 'button', class: 'rl-btn', onclick: () => closeDialog(state.session) }, 'Close') : null,
    ),
  );
}

function renderRight() {
  const root = clear(els.right);
  if (state.loading) {
    root.append(loader());
    return;
  }
  if (state.error) {
    root.append(state.setup
      ? notice('warning', 'ReviewLoop needs its worker', h('p', {}, state.error), h('p', {}, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'How to set up the worker')))
      : notice('error', 'Could not check the review', h('p', {}, state.error)));
    return;
  }
  if (state.result) {
    root.append(resultView());
    return;
  }
  const g = gate();
  const { review } = state;
  root.append(h('h2', { class: 'rl-form-title' }, 'Publish'));
  if (open(review)) root.append(reviewCard(review));
  if (blocked(g)) {
    root.append(notice('error', 'Approval required', h('p', {}, open(review)
      ? `This site only publishes approved pages. ${g === 'edited' ? 'Send the new changes back for review from the ReviewLoop panel.' : `Wait for ${review.assignee?.name || 'the reviewer'} to approve ${review.key}.`}`
      : 'This site only publishes approved pages. Use Prepare › Request review first.')));
    return;
  }
  if (needsConfirm(g)) {
    root.append(h(
      'label',
      { class: 'rl-confirm' },
      h('input', {
        type: 'checkbox',
        checked: state.confirmed,
        onchange: (e) => {
          state.confirmed = e.target.checked;
          renderRight();
        },
      }),
      h('span', {}, confirmText(g)),
    ));
  }
  root.append(h('p', { class: 'rl-small rl-muted' }, open(review)
    ? `Publishes ${state.session.page.webPath} with your permissions, then closes ${review.key} with a link to the live page.`
    : `Publishes ${state.session.page.webPath} with your permissions.`));
  if (state.publishError) root.append(notice('error', 'Not published', h('p', {}, state.publishError)));
  const label = g === 'approved' || g === 'same' || g === 'none' ? 'Publish' : 'Publish anyway';
  root.append(h(
    'div',
    { class: 'rl-actions' },
    h('button', {
      type: 'button',
      class: `rl-btn ${needsConfirm(g) && g !== 'none' ? 'rl-btn-warning' : 'rl-btn-primary'}`,
      disabled: state.publishing || (needsConfirm(g) && !state.confirmed),
      onclick: () => actions.publish(),
    }, state.publishing ? 'Publishing…' : label),
  ));
}

function render() {
  const { page } = state.session;
  clear(els.head).append(h(
    'div',
    {},
    h('h1', {}, 'Publish (reviewed)'),
    h('p', { class: 'rl-muted' }, state.compared ? `${pageTitle()} · ${page.webPath}` : page.webPath),
  ));
  renderLeft();
  renderRight();
}

/* Actions */

async function publish() {
  const { session, review } = state;
  const g = gate();
  state.publishing = true;
  state.publishError = '';
  renderRight();
  const res = await session.publish();
  if (!res.ok) {
    state.publishing = false;
    state.publishError = res.error;
    renderRight();
    return;
  }
  const result = {
    url: res.url, demo: res.demo, key: '', jiraOk: true, jiraError: '',
  };
  if (open(review)) {
    result.key = review.key;
    const jira = await session.api.published({
      org: session.page.org,
      site: session.page.site,
      path: session.page.path,
      key: review.key,
      comment: publishedComment({
        liveUrl: res.url,
        publisher: session.user,
        editsSinceApproval: g === 'edited' ? state.compared.sinceReview.length : 0,
        notApproved: g === 'pending' ? STATES[review.state]?.label || review.status || 'In review' : '',
      }),
    });
    result.jiraOk = jira.ok && jira.moved !== false;
    if (!jira.ok) result.jiraError = `The page is live, but Jira could not be updated: ${jira.error}`;
    else if (!result.jiraOk) result.jiraError = `The live link was added, but the issue was not closed. ${jira.warnings?.[0] || ''}`.trim();
  }
  state.publishing = false;
  state.result = result;
  renderRight();
}

async function load() {
  const { session } = state;
  const [found, versions] = await Promise.all([
    session.api.get(session.page),
    session.versions(),
  ]);
  state.loading = false;
  const failed = [found, versions].find((r) => !r.ok);
  if (failed) {
    state.error = failed.error;
    state.setup = Boolean(failed.setup);
    render();
    return;
  }
  if (found.user) session.user = found.user;
  state.review = found.review || null;
  state.compared = compare(versions, open(state.review) ? state.review.snapshot : null);
  render();
}

function demoBar() {
  return h(
    'div',
    { class: 'rl-demo', role: 'note' },
    h('span', {}, 'Demo: nothing is published and nothing is sent to Jira.'),
    h('button', {
      type: 'button',
      class: 'rl-btn rl-btn-small',
      onclick: () => { state.session.api.reset(); window.location.reload(); },
    }, 'Reset demo'),
  );
}

Object.assign(actions, { publish });

async function init() {
  const root = document.querySelector('main');
  els.head = h('header', { class: 'rl-head' });
  els.left = h('section', { class: 'rl-pane rl-pane-changes', 'aria-label': 'What goes live' });
  els.right = h('section', { class: 'rl-pane rl-pane-form', 'aria-label': 'Publish' });
  root.append(els.head, h('div', { class: 'rl-grid' }, els.left, els.right));
  els.left.append(loader());
  state.session = await startSession();
  if (state.session.mode === 'demo') root.prepend(demoBar());
  render();
  await load();
}

init();
