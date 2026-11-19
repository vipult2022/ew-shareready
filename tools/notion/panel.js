import { h, clear, fill } from './lib/dom.js';

const DOCS_URL = 'https://github.com/vipult2022/ew-shareready/tree/main/tools/notion#readme';
const SEARCH = '__search';
const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3" width="17" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 16.5v-9l7 9v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HIDDEN = ['title'];

function logo() {
  const span = h('span', { class: 'nt-logo' });
  span.innerHTML = LOGO;
  return span;
}

function ago(iso) {
  const then = Date.parse(iso || '');
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((then - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  if (Math.abs(minutes) < 60 * 24) return rtf.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(minutes) < 60 * 24 * 30) return rtf.format(Math.round(minutes / 1440), 'day');
  return new Date(then).toLocaleDateString();
}

function statusOf(page) {
  return page.properties.find((p) => p.name === 'Status' && p.value);
}

function pill(prop) {
  return prop && h('span', { class: `nt-pill nt-c-${prop.color || 'default'}` }, prop.value);
}

function icon(page) {
  const value = page.icon || '';
  if (/^https:\/\//.test(value)) return h('img', { class: 'nt-icon', src: value, alt: '' });
  return h('span', { class: 'nt-icon', 'aria-hidden': 'true' }, value || '📄');
}

export default function createPanel(root, state, actions) {
  let toastTimer;
  const els = {};

  function header() {
    const { conn } = state;
    return h(
      'header',
      { class: 'nt-head' },
      h('div', { class: 'nt-title' }, logo(), h('h1', {}, 'Notion')),
      h(
        'div',
        { class: 'nt-head-actions' },
        conn && h('span', { class: `nt-chip nt-chip-${conn.mode}` }, conn.label),
        conn && state.view === 'main' && h('button', {
          class: 'nt-icon-btn', type: 'button', title: 'Reload from Notion', 'aria-label': 'Reload from Notion', onclick: actions.refresh,
        }, '↻'),
      ),
    );
  }

  function setupView() {
    return h(
      'section',
      { class: 'nt-setup' },
      h('h2', {}, 'Connect Notion to this site'),
      h('p', {}, 'Turn Notion briefs and drafts into Experience Workspace pages, with headings, tables, accordions, columns and images kept.'),
      h('p', {}, 'Notion only accepts calls from a server, so a site admin deploys a small free Cloudflare worker that holds the Notion integration secret, then adds its address to the site config.'),
      h(
        'ol',
        { class: 'nt-steps' },
        h('li', {}, 'Create an internal integration at ', h('a', { href: 'https://www.notion.so/profile/integrations', target: '_blank', rel: 'noopener' }, 'notion.so/profile/integrations'), ' and share your pages with it.'),
        h('li', {}, 'Deploy the worker from this repo with the integration secret.'),
        h('li', {}, 'In the site config, add a ', h('code', {}, 'notion'), ' sheet with ', h('code', {}, 'worker-url'), '.'),
      ),
      h('p', {}, h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'Step-by-step setup guide')),
      h('button', { class: 'nt-btn', type: 'button', onclick: actions.tryDemo }, 'Try it with sample data'),
    );
  }

  function sourcePicker() {
    const { source } = state;
    const browse = state.settings['allow-browse'] !== 'no' || !state.sources.length;
    let value = SEARCH;
    const same = (s) => source && s.id === source.id && s.title === source.title;
    const at = state.sources.findIndex(same);
    const db = state.databases.findIndex((d) => source && d.id === source.id);
    if (at >= 0) value = `s:${at}`;
    else if (db >= 0) value = `d:${db}`;
    const opt = (v, label) => h('option', { value: v, selected: v === value }, label);
    const groups = [];
    if (state.sources.length) groups.push(h('optgroup', { label: 'This site' }, state.sources.map((s, i) => opt(`s:${i}`, s.title))));
    const listed = new Set(state.sources.map((s) => s.id.replace(/-/g, '')));
    const others = state.databases.map((d, i) => ({ d, i }))
      .filter(({ d }) => !listed.has(d.id.replace(/-/g, '')) || value === `d:${state.databases.indexOf(d)}`);
    if (browse && others.length) groups.push(h('optgroup', { label: 'Databases' }, others.map(({ d, i }) => opt(`d:${i}`, `${d.icon ? `${d.icon} ` : ''}${d.title}`))));
    if (browse) groups.push(opt(SEARCH, 'Search all shared pages'));
    return h(
      'label',
      { class: 'nt-field', for: 'nt-source' },
      h('span', { class: 'nt-label' }, 'Source'),
      h('select', { id: 'nt-source', onchange: (e) => actions.chooseSource(e.target.value) }, groups),
    );
  }

  function pageRow(page) {
    const edited = ago(page.lastEdited);
    return h(
      'li',
      {},
      h(
        'button',
        { class: 'nt-page', type: 'button', onclick: () => actions.openPage(page.id) },
        icon(page),
        h(
          'span',
          { class: 'nt-page-text' },
          h('strong', {}, page.title || 'Untitled'),
          h('span', { class: 'nt-meta' }, pill(statusOf(page)), edited && h('span', { class: 'nt-muted' }, `Edited ${edited}`)),
        ),
        h('span', { class: 'nt-chevron', 'aria-hidden': 'true' }, '›'),
      ),
    );
  }

  function renderPages() {
    if (!els.pages) return;
    const q = state.query.trim().toLowerCase();
    const shown = state.source?.id === SEARCH || !q
      ? state.pages
      : state.pages.filter((p) => p.title.toLowerCase().includes(q));
    let empty = 'No pages here yet.';
    if (state.pages.length) empty = 'No pages match your search.';
    else if (state.source?.id === SEARCH) empty = 'No shared pages found. Share pages with the integration in Notion.';
    fill(
      els.pages,
      shown.length
        ? h('ul', { class: 'nt-page-list' }, shown.map(pageRow))
        : !state.busy && h('p', { class: 'nt-muted nt-empty' }, empty),
      state.more && h('p', { class: 'nt-muted nt-hint' }, `Showing the first ${state.pages.length}. Search to narrow the list.`),
    );
  }

  function listView() {
    const placeholder = state.source?.id === SEARCH ? 'Search Notion' : `Search ${state.source?.title || 'pages'}`;
    els.pages = h('div', { class: 'nt-pages' });
    return [
      sourcePicker(),
      state.source && h('input', {
        class: 'nt-search', type: 'search', placeholder, value: state.query, 'aria-label': 'Search pages', oninput: (e) => actions.search(e.target.value),
      }),
      els.pages,
    ];
  }

  function chips(page) {
    const props = page.properties
      .filter((p) => p.value && !HIDDEN.includes(p.type) && p.name !== state.settings['description-property'])
      .sort((a, b) => (b.name === 'Status') - (a.name === 'Status'));
    return h('ul', { class: 'nt-props' }, props.map((p) => {
      let { value } = p;
      if (p.name === 'Status') value = pill(p);
      else if (p.type === 'url') value = h('a', { href: p.value, target: '_blank', rel: 'noopener' }, p.value.replace(/^https:\/\//, ''));
      return h('li', { class: 'nt-prop' }, h('span', { class: 'nt-muted' }, p.name), value);
    }));
  }

  function optionsSection() {
    const toggle = (key, label, hint) => h('label', { class: 'nt-check', title: hint }, h('input', { type: 'checkbox', checked: state.options[key], onchange: (e) => actions.setOption(key, e.target.checked) }), h('span', {}, label));
    return h(
      'div',
      { class: 'nt-options' },
      h('span', { class: 'nt-label' }, 'Include'),
      toggle('title', 'Page title as the main heading', 'Adds the Notion title as the H1'),
      toggle('metadata', 'Metadata block', 'Title, description and keywords from the Notion properties'),
      toggle('sections', 'Dividers start new sections', 'Each Notion divider becomes a section break'),
    );
  }

  function createSection() {
    const { created } = state;
    if (created) {
      return h(
        'div',
        { class: 'nt-created', role: 'status' },
        h('strong', {}, `Created ${created.path}`),
        h('a', {
          class: 'nt-btn nt-primary', href: created.url, target: '_blank', rel: 'noopener',
        }, 'Open in Experience Workspace'),
        created.linked && h('p', { class: 'nt-muted' }, `Linked back in Notion under “${created.linked}”.`),
        created.linkError && h('p', { class: 'nt-muted' }, `Not linked in Notion: ${created.linkError}`),
      );
    }
    return h(
      'form',
      { class: 'nt-create', onsubmit: (e) => { e.preventDefault(); actions.createPage(); } },
      h('label', { class: 'nt-label', for: 'nt-path' }, 'Or create a new page'),
      h(
        'div',
        { class: 'nt-row' },
        h('input', {
          id: 'nt-path', type: 'text', value: state.path, spellcheck: 'false', autocomplete: 'off', oninput: (e) => actions.setPath(e.target.value),
        }),
        h('button', { class: 'nt-btn', type: 'submit', disabled: !!state.busy }, 'Create page'),
      ),
      h('p', { class: 'nt-muted nt-hint' }, 'Images are copied into the site. An existing page is never overwritten.'),
    );
  }

  function renderPreview() {
    if (!els.preview) return;
    const result = actions.converted();
    clear(els.preview);
    if (!result?.html) {
      els.preview.append(h('p', { class: 'nt-muted nt-empty' }, 'This Notion page is empty.'));
    } else {
      const doc = h('div', { class: 'nt-doc' });
      // Built by lib/convert.js, which escapes every Notion value.
      doc.innerHTML = result.html;
      doc.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
      els.preview.append(doc);
    }
    if (els.skipped) {
      fill(els.skipped, result?.skipped?.length > 0 && h('p', { class: 'nt-warn' }, `Not brought over: ${[...new Set(result.skipped)].join(', ')}.`));
    }
  }

  function detailView() {
    const { page } = state.current;
    const description = page.properties
      .find((p) => p.name === state.settings['description-property'])?.value;
    els.skipped = h('div', {});
    els.preview = h('div', { class: 'nt-preview' });
    return [
      h('button', { class: 'nt-back', type: 'button', onclick: actions.back }, '‹ All pages'),
      h(
        'div',
        { class: 'nt-detail-head' },
        icon(page),
        h('div', {}, h('h2', {}, page.title || 'Untitled'), description && h('p', { class: 'nt-muted' }, description)),
      ),
      chips(page),
      h('a', {
        class: 'nt-open', href: page.url, target: '_blank', rel: 'noopener',
      }, 'Open in Notion ↗'),
      optionsSection(),
      els.skipped,
      h('div', { class: 'nt-preview-wrap' }, h('span', { class: 'nt-label' }, 'Preview'), els.preview),
      createSection(),
    ];
  }

  function renderFooter() {
    if (!els.footer) return;
    const ready = !!actions.converted()?.html && !state.busy;
    const inBlock = state.mode === 'ew' && state.live.blockIndex !== null;
    fill(
      els.footer,
      inBlock && h('p', { class: 'nt-warn' }, 'Your cursor is inside a block. Click an empty line outside it to insert.'),
      h(
        'div',
        { class: 'nt-actions' },
        h('button', {
          class: 'nt-btn', type: 'button', disabled: !ready, onclick: actions.copy,
        }, 'Copy'),
        h('button', {
          class: 'nt-btn nt-primary', type: 'button', disabled: !ready || inBlock, onclick: actions.insert,
        }, state.mode === 'demo' ? 'Insert (in EW)' : 'Insert into this page'),
      ),
    );
  }

  function mainView() {
    const parts = [];
    if (state.current) parts.push(detailView());
    else parts.push(listView());
    if (state.error) parts.push(h('div', { class: 'nt-error', role: 'alert' }, state.error.message || String(state.error)));
    return h('section', { class: 'nt-main' }, parts);
  }

  function render() {
    els.pages = null;
    els.preview = null;
    els.skipped = null;
    const body = [];
    if (state.view === 'setup') body.push(setupView());
    else if (state.view === 'main') body.push(mainView());
    els.busy = h('div', { class: 'nt-busy', role: 'status', hidden: !state.busy }, h('span', { class: 'nt-spinner' }), h('span', {}, state.busy));
    els.footer = state.view === 'main' && state.current ? h('footer', { class: 'nt-foot' }) : null;
    fill(
      root,
      header(),
      state.mode === 'demo' && h('p', { class: 'nt-banner' }, 'Sample Northwind briefs. Open from Experience Workspace to use your own Notion pages.'),
      els.busy,
      ...body,
      els.footer || '',
      els.toast || (els.toast = h('div', { class: 'nt-toast', role: 'status', hidden: true })),
    );
    renderPages();
    renderPreview();
    renderFooter();
  }

  function setBusy(text) {
    state.busy = text;
    if (!els.busy) return;
    els.busy.hidden = !text;
    els.busy.lastChild.textContent = text;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
  }

  return {
    render,
    renderPages,
    renderPreview,
    renderFooter,
    setBusy,
    toast,
    scrollTop: () => window.scrollTo(0, 0),
  };
}
