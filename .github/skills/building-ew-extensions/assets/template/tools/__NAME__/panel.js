/**
 * Rendering only. State lives in __NAME__.js; this file never fetches or writes.
 * Data is always added as text nodes (h/fill), never through innerHTML.
 */

import { h, fill } from './lib/dom.js';
import { filterItems } from './lib/items.js';

const P = '__PREFIX__';
const TOAST_MS = 4000;

export default function createPanel(root, state, actions) {
  const head = h('header', { class: `${P}-head` });
  const body = h('div', { class: `${P}-body` });
  const foot = h('footer', { class: `${P}-foot`, hidden: true });
  const toastEl = h('div', { class: `${P}-toast`, role: 'status', 'aria-live': 'polite' });
  let list = null;
  let toastTimer;
  fill(root, head, body, foot, toastEl);

  const button = (label, onclick, variant = '') => h('button', {
    type: 'button',
    class: variant ? `${P}-button ${P}-${variant}` : `${P}-button`,
    onclick,
    disabled: !!state.busy,
  }, label);

  function renderHead() {
    const badge = { demo: 'Sample data', ew: 'Live', da: 'Live' }[state.mode];
    fill(
      head,
      h('h1', { class: `${P}-title` }, '__TITLE__'),
      badge && h('span', { class: `${P}-badge` }, badge),
      state.conn && button('Refresh', actions.refresh, 'quiet'),
    );
  }

  /** Only the list is redrawn while typing, so the filter box keeps focus. */
  function renderList() {
    if (!list) return;
    const items = filterItems(state.items, state.query);
    fill(list, items.length
      ? items.map((item) => h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: `${P}-item`, onclick: () => actions.choose(item.id) },
          h('strong', {}, item.title),
          item.summary && h('span', { class: `${P}-muted` }, item.summary),
        ),
      ))
      : h('li', { class: `${P}-empty ${P}-muted` }, state.query ? `Nothing matches “${state.query}”.` : 'Nothing to show yet.'));
  }

  function renderDetail(item) {
    fill(
      body,
      button('← Back', actions.back, 'quiet'),
      h(
        'article',
        { class: `${P}-detail` },
        h('h2', {}, item.title),
        item.summary && h('p', {}, item.summary),
        item.url && h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the original'),
      ),
      h(
        'div',
        { class: `${P}-actions` },
        button('Insert', actions.insert, 'primary'),
        button('Copy', actions.copy),
      ),
    );
  }

  function renderBody() {
    list = null;
    if (state.error) {
      fill(body, h(
        'div',
        { class: `${P}-error`, role: 'alert' },
        h('p', {}, state.error.message || String(state.error)),
        button('Try again', actions.refresh),
      ));
      return;
    }
    if (state.view === 'loading') {
      fill(body, h('p', { class: `${P}-muted` }, 'Loading…'));
      return;
    }
    if (state.view === 'setup') {
      fill(body, h(
        'div',
        { class: `${P}-setup` },
        h('h2', {}, 'Almost ready'),
        h(
          'p',
          {},
          'Add a ',
          h('code', {}, '__NAME__'),
          ' sheet to this site’s config with a ',
          h('code', {}, 'worker-url'),
          ' row, then reload Experience Workspace.',
        ),
        button('Try with sample data', actions.tryDemo, 'primary'),
      ));
      return;
    }
    if (state.busy) {
      fill(body, h('p', { class: `${P}-muted`, 'aria-busy': 'true' }, state.busy));
      return;
    }
    if (state.current) {
      renderDetail(state.current);
      return;
    }
    list = h('ul', { class: `${P}-list` });
    fill(
      body,
      h('input', {
        type: 'search',
        class: `${P}-search`,
        placeholder: 'Filter',
        'aria-label': 'Filter',
        value: state.query,
        oninput: (e) => actions.search(e.target.value),
      }),
      list,
    );
    renderList();
  }

  function renderFooter() {
    let note = '';
    if (state.mode === 'demo') note = 'Sample data. Open this panel from Experience Workspace to insert.';
    else if (state.mode === 'ew' && !state.live.editable) note = 'This page is read-only for you.';
    else if (state.mode === 'ew' && state.live.blockIndex !== null) note = 'Your cursor is inside a block. Click an empty line to insert.';
    fill(foot, note && h('p', { class: `${P}-muted` }, note));
    foot.hidden = !note;
  }

  function render() {
    renderHead();
    renderBody();
    renderFooter();
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add(`${P}-show`);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove(`${P}-show`), TOAST_MS);
  }

  return {
    render, renderList, renderFooter, toast,
  };
}
