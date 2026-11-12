import { h, clear } from './lib/dom.js';
import { compare, titleOf } from './lib/page.js';
import { dueDate } from './lib/config.js';
import { createPayload, resubmitPayload } from './lib/requests.js';
import {
  changeList, statusChip, summarize, loader, notice, plural, ago,
} from './lib/view.js';
import { startSession, closeDialog, DOCS_URL } from './lib/session.js';

const state = {
  session: null,
  loading: true,
  error: '',
  jira: null,
  review: null,
  result: null,
  compared: null,
  tab: 'live',
  type: null,
  due: '',
  note: '',
  sending: false,
  sendError: '',
};

const els = {};
/* Filled in at the end of the file, so handlers can call functions defined later. */
const view = {};
const actions = {};

function mode() {
  const { review } = state;
  return review && review.state !== 'done' ? 'resubmit' : 'create';
}

function pageTitle() {
  const units = state.compared?.units || [];
  return titleOf(units, state.session.page.webPath);
}

function shownChanges() {
  const c = state.compared;
  if (!c) return [];
  return state.tab === 'review' && c.sinceReview ? c.sinceReview : c.sinceLive;
}

function summary() {
  return `${state.type?.name || 'Content'} review: ${pageTitle()}`.slice(0, 200);
}

/* Left: what changed */

function tab(id, label, count) {
  const selected = state.tab === id;
  return h('button', {
    type: 'button',
    role: 'tab',
    class: 'rl-tab',
    'aria-selected': String(selected),
    onclick: () => {
      state.tab = id;
      view.changes();
    },
  }, label, h('span', { class: 'rl-count' }, String(count)));
}

function renderChanges() {
  const root = clear(els.changes);
  if (state.loading) {
    root.append(loader('Comparing the draft with the live page'), h('p', { class: 'rl-muted rl-center' }, 'Updating the preview and comparing it with the live page…'));
    return;
  }
  const c = state.compared;
  if (!c) return;
  const tabs = [tab('live', 'Since live', c.sinceLive.length)];
  if (c.sinceReview) tabs.unshift(tab('review', `Since round ${state.review.round || 1}`, c.sinceReview.length));
  root.append(h('div', { class: 'rl-tabs', role: 'tablist', 'aria-label': 'Compare with' }, tabs));
  if (c.firstVersion && state.tab === 'live') {
    root.append(notice('info', 'First version', h('p', {}, 'This page has never been published, so the reviewer will read the whole page.')));
  }
  const list = shownChanges();
  const lede = state.tab === 'review'
    ? `${summarize(list)} since ${state.review.key} was last sent for review.`
    : `${summarize(list)} compared with the live page.`;
  root.append(h('p', { class: 'rl-lede' }, lede));
  root.append(changeList(list, state.tab === 'review'
    ? 'Nothing changed since the last review.'
    : 'The draft matches the live page.'));
  if (state.session.previewError) {
    root.append(notice('warning', 'The preview was not updated', h('p', {}, `${state.session.previewError} The comparison uses the last preview.`)));
  }
}

/* Right: the request */

function typePicker() {
  const { types } = state.session.config;
  return h(
    'fieldset',
    { class: 'rl-field' },
    h('legend', {}, 'Review type'),
    h('div', { class: 'rl-segments' }, types.map((t) => h(
      'label',
      { class: 'rl-segment' },
      h('input', {
        type: 'radio',
        name: 'type',
        value: t.name,
        checked: state.type === t,
        onchange: () => {
          state.type = t;
          state.due = dueDate(t.dueDays);
          view.form();
        },
      }),
      h('span', {}, t.name),
    ))),
    state.type?.assignee ? h('p', { class: 'rl-hint' }, `Assigned to ${state.type.assignee}`) : null,
  );
}

function checklist() {
  const items = state.type?.checklist || [];
  if (!items.length) return null;
  return h(
    'div',
    { class: 'rl-field' },
    h('span', { class: 'rl-label' }, 'Checklist for the reviewer'),
    h('ul', { class: 'rl-checklist' }, items.map((item) => h('li', {}, item))),
  );
}

function noteField(label, placeholder) {
  return h(
    'label',
    { class: 'rl-field' },
    h('span', { class: 'rl-label' }, label),
    h('textarea', {
      rows: '3',
      maxlength: '1000',
      placeholder,
      oninput: (e) => { state.note = e.target.value; },
    }, state.note),
  );
}

function sendsList() {
  const c = state.compared;
  const list = mode() === 'resubmit' ? c.sinceReview || [] : c.sinceLive;
  const items = mode() === 'resubmit'
    ? [
      `A comment on ${state.review.key} with ${list.length ? `only the ${plural(list.length, 'change')} since round ${state.review.round || 1}` : 'your note (nothing changed since the last round)'}`,
      'The issue moves back to In review',
    ]
    : [
      `Summary: “${summary()}”`,
      'Links: Preview · Open in Experience Workspace · Live page',
      c.firstVersion ? 'A note that this is the first version' : `A table of the ${plural(list.length, 'change')} since live, with before and after`,
      state.type?.checklist?.length ? `The ${state.type.name} checklist` : null,
      state.due ? `Due ${new Date(`${state.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : null,
    ];
  return h(
    'div',
    { class: 'rl-sends' },
    h('span', { class: 'rl-label' }, `What ${state.jira?.project ? `Jira (${state.jira.project})` : 'Jira'} gets`),
    h('ul', {}, items.filter(Boolean).map((item) => h('li', {}, item))),
  );
}

function reviewCard() {
  const { review } = state;
  return h(
    'div',
    { class: 'rl-review-card' },
    h('div', { class: 'rl-review-row' }, h('a', {
      href: review.url, target: '_blank', rel: 'noopener', class: 'rl-key',
    }, review.key), statusChip(review)),
    h('p', { class: 'rl-muted' }, [
      review.reviewType ? `${review.reviewType} review` : 'Review',
      review.assignee?.name ? ` · ${review.assignee.name}` : '',
      ` · round ${review.round || 1}`,
      review.requestedAt ? ` · sent ${ago(review.requestedAt)}` : '',
    ].join('')),
  );
}

function resultView() {
  const { result } = state;
  return h(
    'div',
    { class: 'rl-result' },
    h('div', { class: 'rl-result-icon', 'aria-hidden': 'true' }, '✓'),
    h('h2', {}, result.created ? `${result.key} created` : `${result.key} is back in review`),
    h('p', {}, result.created
      ? `${state.type?.assignee || 'The reviewer'} will see the ${state.compared.firstVersion ? 'whole page' : plural(state.compared.sinceLive.length, 'change')} in Jira.`
      : `The reviewer will see only the ${plural((state.compared.sinceReview || []).length, 'change')} since the last round.`),
    h('p', { class: 'rl-muted' }, 'Follow comments and approval in the ReviewLoop panel.'),
    h(
      'div',
      { class: 'rl-actions' },
      h('a', {
        class: 'rl-btn rl-btn-primary', href: result.url, target: '_blank', rel: 'noopener',
      }, 'Open in Jira'),
      state.session.sdk ? h('button', { type: 'button', class: 'rl-btn', onclick: () => closeDialog(state.session) }, 'Close') : null,
    ),
  );
}

function setupView(error) {
  return notice(
    'warning',
    'ReviewLoop needs its worker',
    h('p', {}, error),
    h('p', {}, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'How to set up the worker')),
  );
}

function buttonLabel(resubmit) {
  if (state.sending) return 'Sending…';
  return resubmit ? 'Send back for review' : 'Send to Jira';
}

function renderForm() {
  const root = clear(els.form);
  if (state.loading) {
    root.append(loader());
    return;
  }
  if (state.error) {
    root.append(state.errorSetup ? setupView(state.error) : notice('error', 'Could not load the review', h('p', {}, state.error)));
    return;
  }
  if (state.result) {
    root.append(resultView());
    return;
  }
  const resubmit = mode() === 'resubmit';
  root.append(h('h2', { class: 'rl-form-title' }, resubmit ? 'Send back for review' : 'Request a review'));
  if (resubmit) {
    root.append(reviewCard());
    if (state.review.state === 'approved' && state.compared.sinceReview?.length) {
      root.append(notice('warning', 'Edited after approval', h('p', {}, `${plural(state.compared.sinceReview.length, 'change')} since ${state.review.approvedBy || 'the reviewer'} approved. Send them for a quick re-review.`)));
    }
    root.append(noteField('Note for the reviewer', 'e.g. Added the variable-rate wording you asked for.'));
  } else {
    root.append(
      typePicker(),
      h(
        'label',
        { class: 'rl-field' },
        h('span', { class: 'rl-label' }, 'Due'),
        h('input', {
          type: 'date',
          value: state.due,
          min: new Date().toISOString().slice(0, 10),
          onchange: (e) => { state.due = e.target.value; view.form(); },
        }),
      ),
      noteField('Note for the reviewer', 'e.g. Rate approved by Treasury on 10 Nov. Please check the APY wording.'),
      checklist(),
    );
  }
  root.append(sendsList());
  if (state.sendError) root.append(notice('error', 'Not sent', h('p', {}, state.sendError)));
  root.append(h(
    'div',
    { class: 'rl-actions' },
    h('button', {
      type: 'button',
      class: 'rl-btn rl-btn-primary',
      disabled: state.sending,
      onclick: () => actions.send(),
    }, buttonLabel(resubmit)),
  ));
}

function render() {
  const { page } = state.session;
  clear(els.head).append(
    h('div', {}, h('h1', {}, 'Request review'), h('p', { class: 'rl-muted' }, state.compared ? `${pageTitle()} · ${page.webPath}` : page.webPath)),
  );
  renderChanges();
  renderForm();
}

/* Actions */

async function send() {
  const { session } = state;
  state.sending = true;
  state.sendError = '';
  renderForm();
  const args = {
    page: session.page,
    title: pageTitle(),
    note: state.note,
    requester: session.user || 'An author',
    compared: state.compared,
  };
  let res;
  if (mode() === 'resubmit') {
    res = await session.api.resubmit(resubmitPayload({ ...args, review: state.review }));
    if (res.ok) state.result = { key: state.review.key, url: state.review.url, created: false };
  } else {
    res = await session.api.create(createPayload({ ...args, type: state.type, due: state.due }));
    if (res.ok) state.result = { key: res.key, url: res.url, created: true };
  }
  state.sending = false;
  if (!res.ok) state.sendError = res.error;
  renderForm();
}

async function load() {
  const { session } = state;
  state.type = session.config.types[0] || null;
  state.due = dueDate(state.type?.dueDays ?? session.config.dueDays);
  const [status, found, versions] = await Promise.all([
    session.api.status(),
    session.api.get(session.page),
    session.versions(),
  ]);
  state.loading = false;
  const failed = [status, found, versions].find((r) => !r.ok);
  if (failed) {
    state.error = failed.error;
    state.errorSetup = failed.setup || status.ok === false;
    render();
    return;
  }
  state.jira = status.jira || null;
  state.review = found.review || null;
  if (found.user) session.user = found.user;
  const snapshot = state.review && state.review.state !== 'done' ? state.review.snapshot : null;
  state.compared = compare(versions, snapshot);
  state.tab = state.compared.sinceReview ? 'review' : 'live';
  render();
}

function demoBar(api) {
  const reload = () => window.location.reload();
  return h(
    'div',
    { class: 'rl-demo', role: 'note' },
    h('span', {}, api.draft === 'review2'
      ? 'Demo: the draft includes the reviewer’s fix.'
      : 'Demo: Northwind Bank, Spring Savings offer. Nothing is sent to Jira.'),
    api.draft === 'review2' ? null : h('button', {
      type: 'button', class: 'rl-btn rl-btn-small', onclick: () => { api.fix(); reload(); },
    }, 'Make the reviewer’s fix'),
    h('button', {
      type: 'button', class: 'rl-btn rl-btn-small', onclick: () => { api.reset(); reload(); },
    }, 'Reset demo'),
  );
}

Object.assign(view, { changes: renderChanges, form: renderForm });
Object.assign(actions, { send });

async function init() {
  const root = document.querySelector('main');
  els.head = h('header', { class: 'rl-head' });
  els.changes = h('section', { class: 'rl-pane rl-pane-changes', 'aria-label': 'What changed' });
  els.form = h('section', { class: 'rl-pane rl-pane-form', 'aria-label': 'Review request' });
  root.append(els.head, h('div', { class: 'rl-grid' }, els.changes, els.form));
  els.changes.append(loader());
  state.session = await startSession();
  if (state.session.mode === 'demo') root.prepend(demoBar(state.session.api));
  render();
  await load();
}

init();
