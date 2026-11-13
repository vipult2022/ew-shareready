import { h, clear } from './lib/dom.js';
import { compare, titleOf } from './lib/page.js';
import { locate } from './lib/comments.js';
import { resubmitPayload } from './lib/requests.js';
import {
  changeList, statusChip, summarize, loader, notice, plural, ago, formatDate, approvedLine,
} from './lib/view.js';
import { startSession, DOCS_URL } from './lib/session.js';
import { DEMO_REVIEWER } from './lib/api.js';

const POLL = 30000;

const state = {
  session: null,
  loading: true,
  error: '',
  setup: false,
  review: null,
  compared: null,
  note: '',
  sending: false,
  sendError: '',
  sent: '',
  checkedAt: 0,
};

const els = {};
const actions = {};

function title() {
  return titleOf(state.compared?.units || [], state.session.page.webPath);
}

function open(review) {
  return review && review.state !== 'done';
}

function editsSinceReview() {
  return state.compared?.sinceReview || [];
}

/* Pieces */

function where(comment) {
  const spot = locate(comment.text, state.compared?.units);
  if (!spot) return null;
  if (!spot.found.length) {
    return h('p', { class: 'rl-where rl-where-gone' }, '✓ The quoted text is no longer on the page');
  }
  return h('p', { class: 'rl-where' }, `On the page: ${spot.found.join(', ')}`);
}

function initials(name) {
  return name.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2)
    .toUpperCase();
}

function commentItem(comment) {
  const author = comment.author || 'Someone';
  // The worker marks comments it posted for the author; the demo matches by name.
  const mine = typeof comment.own === 'boolean' ? comment.own : author === state.session.user;
  return h(
    'li',
    { class: `rl-comment${mine ? ' rl-comment-mine' : ''}` },
    h(
      'div',
      { class: 'rl-comment-head' },
      h('span', { class: 'rl-avatar', 'aria-hidden': 'true' }, initials(author)),
      h('strong', {}, author),
      h('time', { datetime: comment.created, title: formatDate(comment.created) }, ago(comment.created)),
    ),
    h('p', { class: 'rl-comment-text' }, comment.text),
    mine ? null : where(comment),
  );
}

function comments(review) {
  const list = review.comments || [];
  if (!list.length) {
    return h('p', { class: 'rl-muted rl-small' }, `No comments yet. They appear here when ${review.assignee?.name || 'the reviewer'} replies in Jira.`);
  }
  return h(
    'section',
    { class: 'rl-section' },
    h('h2', {}, `Comments (${list.length})`),
    h('ol', { class: 'rl-comments' }, [...list].reverse().map(commentItem)),
  );
}

function reviewCard(review) {
  const meta = [
    review.reviewType ? `${review.reviewType} review` : 'Review',
    review.assignee?.name,
    `round ${review.round || 1}`,
    review.due ? `due ${new Date(`${review.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '',
  ].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'rl-review-card' },
    h('div', { class: 'rl-review-row' }, h('a', {
      href: review.url, target: '_blank', rel: 'noopener', class: 'rl-key',
    }, review.key), statusChip(review)),
    h('p', { class: 'rl-muted' }, meta),
  );
}

function sendBack(reason) {
  const edits = editsSinceReview();
  if (state.sent) return notice('pass', state.sent);
  return h(
    'section',
    { class: 'rl-section rl-sendback' },
    h('h2', {}, 'Send back for review'),
    h('p', { class: 'rl-small' }, reason),
    edits.length ? changeList(edits) : null,
    h(
      'label',
      { class: 'rl-field' },
      h('span', { class: 'rl-label' }, 'Note for the reviewer'),
      h('textarea', {
        rows: '2',
        maxlength: '1000',
        placeholder: 'e.g. Added the variable-rate wording.',
        oninput: (e) => { state.note = e.target.value; },
      }, state.note),
    ),
    state.sendError ? notice('error', 'Not sent', h('p', {}, state.sendError)) : null,
    h('button', {
      type: 'button',
      class: 'rl-btn rl-btn-primary rl-btn-block',
      disabled: state.sending,
      onclick: () => actions.resubmit(),
    }, state.sending ? 'Sending…' : `Send ${edits.length ? plural(edits.length, 'change') : 'note'} to ${state.review.key}`),
  );
}

function openReview(review) {
  const edits = editsSinceReview();
  const parts = [reviewCard(review)];
  if (review.state === 'approved') {
    if (edits.length) {
      parts.push(notice('warning', 'Approved, then edited', h('p', {}, `${approvedLine(review, review.approvedAt ? ago(review.approvedAt) : '')} ${plural(edits.length, 'change')} made since then ${edits.length === 1 ? 'has' : 'have'} not been reviewed. Send ${edits.length === 1 ? 'it' : 'them'} back, or publish anyway.`)));
      parts.push(sendBack('Only these changes go to the reviewer.'));
    } else {
      parts.push(notice('pass', 'Approved: ready to publish', h('p', {}, `${approvedLine(review, review.approvedAt ? ago(review.approvedAt) : '')} Nothing changed since. Open the ⋯ menu (top right) › Publish (reviewed).`)));
    }
  } else if (review.state === 'changes') {
    parts.push(notice('warning', 'Changes requested', h('p', {}, 'Edit the page, then send it back. The reviewer sees only what you changed.')));
  } else {
    parts.push(h('p', { class: 'rl-small rl-muted' }, edits.length
      ? `${plural(edits.length, 'change')} since you sent it. Send them so the reviewer sees the latest.`
      : `Waiting for ${review.assignee?.name || 'the reviewer'}. This panel checks Jira every 30 seconds.`));
  }
  parts.push(comments(review));
  if (review.state !== 'approved' && (review.state === 'changes' || edits.length)) {
    parts.push(sendBack(edits.length
      ? `${summarize(edits)} since round ${review.round || 1}. Only these go to the reviewer.`
      : 'Nothing changed on the page yet. You can still send a note.'));
  }
  return parts;
}

function noReview(review) {
  const changes = state.compared.sinceLive;
  return [
    h('div', { class: 'rl-review-row' }, h('strong', {}, title()), statusChip(review)),
    review ? h('p', { class: 'rl-small rl-muted' }, `${review.key} was closed when the page was published.`) : null,
    h('p', { class: 'rl-lede' }, state.compared.firstVersion
      ? 'Not published yet: the reviewer will read the whole page.'
      : `${summarize(changes)} since live.`),
    state.compared.firstVersion ? null : changeList(changes, 'The draft matches the live page.'),
    changes.length || state.compared.firstVersion
      ? notice('info', 'Ready for review?', h('p', {}, 'Open the ⋯ menu (top right) › Request review to send these changes to Jira.'))
      : null,
  ];
}

function demoBar() {
  const { api } = state.session;
  const review = state.review && open(state.review);
  const act = (fn) => () => { fn(); actions.refresh(); };
  return h(
    'div',
    { class: 'rl-demo rl-demo-panel', role: 'note' },
    h('span', {}, `Demo: play ${DEMO_REVIEWER.name} in Jira`),
    h(
      'div',
      { class: 'rl-demo-buttons' },
      review ? h('button', { type: 'button', class: 'rl-btn rl-btn-small', onclick: act(() => api.reviewer('changes')) }, 'Request changes') : null,
      review ? h('button', { type: 'button', class: 'rl-btn rl-btn-small', onclick: act(() => api.reviewer('approve')) }, 'Approve') : null,
      api.draft === 'review2' ? null : h('button', { type: 'button', class: 'rl-btn rl-btn-small', onclick: act(() => api.fix()) }, 'Make the fix'),
      h('button', { type: 'button', class: 'rl-btn rl-btn-small', onclick: act(() => api.reset()) }, 'Reset'),
    ),
  );
}

function render() {
  const root = clear(els.root);
  const { session } = state;
  if (session?.mode === 'demo') root.append(demoBar());
  root.append(h(
    'header',
    { class: 'rl-panel-head' },
    h('h1', {}, 'ReviewLoop'),
    h('button', {
      type: 'button',
      class: 'rl-btn rl-btn-small',
      disabled: state.loading,
      onclick: () => actions.refresh(),
      title: state.checkedAt ? `Checked ${formatDate(new Date(state.checkedAt).toISOString())}` : '',
    }, state.loading ? 'Checking…' : 'Refresh'),
  ));
  const body = h('div', { class: 'rl-panel-body' });
  root.append(body);
  if (state.loading && !state.compared) {
    body.append(loader('Checking Jira'));
    return;
  }
  if (state.error) {
    body.append(state.setup
      ? notice('warning', 'ReviewLoop needs its worker', h('p', {}, state.error), h('p', {}, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'How to set up the worker')))
      : notice('error', 'Could not check the review', h('p', {}, state.error)));
    return;
  }
  body.append(...[open(state.review) ? openReview(state.review) : noReview(state.review)]
    .flat().filter(Boolean));
}

/* Actions */

async function refresh() {
  const { session } = state;
  state.loading = true;
  render();
  const [found, versions] = await Promise.all([
    session.api.get(session.page),
    session.versions({ refresh: false }),
  ]);
  state.loading = false;
  state.checkedAt = Date.now();
  const failed = [found, versions].find((r) => !r.ok);
  state.error = failed?.error || '';
  state.setup = Boolean(failed?.setup);
  if (!failed) {
    if (found.user) session.user = found.user;
    const before = state.review;
    state.review = found.review || null;
    if (before?.round !== state.review?.round || before?.key !== state.review?.key) state.sent = '';
    state.compared = compare(versions, open(state.review) ? state.review.snapshot : null);
  }
  render();
}

async function resubmit() {
  const { session, review } = state;
  state.sending = true;
  state.sendError = '';
  render();
  const res = await session.api.resubmit(resubmitPayload({
    page: session.page,
    title: title(),
    review,
    note: state.note,
    requester: session.user || 'An author',
    compared: state.compared,
  }));
  state.sending = false;
  if (res.ok) {
    state.note = '';
    state.sent = `${review.key} is back in review (round ${(review.round || 1) + 1}).`;
    await refresh();
    return;
  }
  state.sendError = res.error;
  render();
}

Object.assign(actions, { refresh, resubmit });

async function init() {
  els.root = document.querySelector('main');
  els.root.append(loader());
  state.session = await startSession();
  await refresh();
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.loading && !state.sending) refresh();
  }, POLL);
}

init();
