import { h, clear, fill } from './lib/dom.js';
import { FORMATS, parseAttachments } from './lib/format.js';
import { tableFields, searchRecords } from './lib/fields.js';

const DOCS_URL = 'https://github.com/vipult2022/ew-shareready/tree/main/tools/airtable#readme';
const TOKENS_URL = 'https://airtable.com/create/tokens';
const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M10 10v10" stroke="currentColor" stroke-width="2"/></svg>';
const TYPE_LABEL = {
  singleLineText: 'Text',
  multilineText: 'Long text',
  richText: 'Rich text',
  multipleAttachments: 'Images',
  url: 'Link',
  email: 'Email',
  phoneNumber: 'Phone',
  currency: 'Currency',
  percent: 'Percent',
  number: 'Number',
  date: 'Date',
  dateTime: 'Date',
  singleSelect: 'Select',
  multipleSelects: 'Tags',
  checkbox: 'Checkbox',
  multipleRecordLinks: 'Linked',
};

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function logo() {
  const span = h('span', { class: 'ax-logo' });
  span.innerHTML = LOGO;
  return span;
}

function select(label, value, options, onChange, extra = {}) {
  const id = `ax-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return h(
    'label',
    { class: 'ax-field', for: id },
    h('span', { class: 'ax-label' }, label),
    h(
      'select',
      { id, onchange: (e) => onChange(e.target.value), ...extra },
      options.map((o) => (o.group
        ? h('optgroup', { label: o.group }, o.options.map((x) => h('option', { value: x.value, selected: x.value === value }, x.label)))
        : h('option', { value: o.value, selected: o.value === value }, o.label))),
    ),
  );
}

export default function createPanel(root, state, actions) {
  let toastTimer;
  const els = {};

  function header() {
    const { conn } = state;
    const chip = conn && h('span', { class: `ax-chip ax-chip-${conn.mode}`, title: conn.mode === 'token' ? 'Reading Airtable with your personal access token, kept in this browser' : '' }, conn.label);
    return h(
      'header',
      { class: 'ax-head' },
      h('div', { class: 'ax-title' }, logo(), h('h1', {}, 'Airtable')),
      h(
        'div',
        { class: 'ax-head-actions' },
        chip,
        conn && state.view === 'main' && h('button', {
          class: 'ax-icon', type: 'button', title: 'Reload from Airtable', 'aria-label': 'Reload from Airtable', onclick: actions.refresh,
        }, '↻'),
        conn?.mode === 'token' && h('button', {
          class: 'ax-link', type: 'button', onclick: actions.disconnect, title: 'Forget the token on this browser',
        }, 'Sign out'),
      ),
    );
  }

  function connectView() {
    const input = h('input', {
      type: 'password', placeholder: 'pat…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Airtable personal access token',
    });
    const submit = (e) => {
      e.preventDefault();
      actions.connectToken(input.value);
    };
    return h(
      'section',
      { class: 'ax-connect' },
      h('h2', {}, 'Connect Airtable'),
      h('p', {}, 'Insert records from any Airtable base as a table, cards, an accordion or text. Paste a personal access token to start; it stays in this browser.'),
      h(
        'ol',
        { class: 'ax-steps' },
        h('li', {}, 'Open ', h('a', { href: TOKENS_URL, target: '_blank', rel: 'noopener' }, 'airtable.com/create/tokens'), ' and choose Create token.'),
        h('li', {}, 'Add the scopes ', h('code', {}, 'data.records:read'), ' and ', h('code', {}, 'schema.bases:read'), '.'),
        h('li', {}, 'Under Access, add the bases you want to use, then copy the token.'),
      ),
      h(
        'form',
        { class: 'ax-token', onsubmit: submit },
        input,
        h('button', { class: 'ax-btn ax-primary', type: 'submit', disabled: !!state.busy }, state.busy ? 'Checking…' : 'Connect'),
      ),
      state.connectError && h('p', { class: 'ax-error', role: 'alert' }, state.connectError),
      h('p', { class: 'ax-muted' }, 'Admins can connect the whole site with a team token instead, so authors never need one. ', h('a', { href: DOCS_URL, target: '_blank', rel: 'noopener' }, 'How to set it up')),
      state.mode !== 'demo' && h('button', { class: 'ax-btn', type: 'button', onclick: actions.tryDemo }, 'Try it with sample data'),
    );
  }

  function sourcePicker() {
    const { source } = state;
    const parts = [];
    const custom = { value: '__browse', label: 'Browse all bases…' };
    if (state.sources.length) {
      const at = state.sources.findIndex((s) => source && s.title === source.title);
      const options = state.sources.map((s, i) => ({ value: String(i), label: s.title }));
      const canBrowse = state.bases.length && state.settings['allow-browse'] !== 'no';
      parts.push(select('Source', at >= 0 ? String(at) : '__browse', canBrowse ? [...options, custom] : options, (v) => {
        if (v === '__browse') actions.chooseBase(source?.base && state.bases.some((b) => b.id === source.base) ? source.base : state.bases[0].id);
        else actions.chooseSource(Number(v));
      }));
      if (at >= 0) return h('div', { class: 'ax-source' }, parts);
    }
    if (state.bases.length) {
      parts.push(select('Base', source?.base || '', state.bases.map((b) => ({ value: b.id, label: b.name })), actions.chooseBase));
    }
    const tables = state.tables.base === source?.base ? state.tables : [];
    if (tables.length) {
      parts.push(select('Table', state.table?.id || source?.table || '', tables.map((t) => ({ value: t.id, label: t.name })), actions.chooseTable));
      const table = tables.find((t) => t.id === (state.table?.id || source?.table));
      if (table?.views?.length > 1) {
        parts.push(select('View', source?.view || '', [{ value: '', label: 'All records' }, ...table.views.map((v) => ({ value: v.id, label: v.name }))], actions.chooseView));
      }
    }
    return h('div', { class: 'ax-source ax-source-grid' }, parts);
  }

  function thumb(record) {
    const field = state.table.fields.find((f) => f.type === 'multipleAttachments' && record.fields[f.name]);
    const att = field && parseAttachments(record.fields[field.name]).find((a) => a.image);
    return att ? h('img', {
      class: 'ax-thumb', src: att.url, alt: '', loading: 'lazy',
    }) : null;
  }

  function recordRow(record) {
    const fields = tableFields(state.table);
    const title = String(record.fields[fields[0]?.name] ?? '').trim() || 'Untitled';
    const second = fields.slice(1).find((f) => !['multipleAttachments', 'richText', 'multilineText'].includes(f.type) && record.fields[f.name]);
    const id = `ax-r-${record.id}`;
    return h(
      'li',
      { class: 'ax-record' },
      h('input', {
        type: 'checkbox', id, checked: state.selected.has(record.id), onchange: () => actions.toggleRecord(record.id),
      }),
      h(
        'label',
        { for: id },
        thumb(record),
        h('span', { class: 'ax-record-text' }, h('strong', {}, title), second && h('span', { class: 'ax-muted' }, `${second.name}: ${record.fields[second.name]}`)),
      ),
    );
  }

  function fieldsSection() {
    const included = state.fields;
    const rest = tableFields(state.table).filter((f) => !included.includes(f));
    const item = (f, on, index) => h(
      'li',
      { class: `ax-fieldrow${on ? ' ax-on' : ''}` },
      h('label', {}, h('input', { type: 'checkbox', checked: on, onchange: () => actions.toggleField(f.id) }), h('span', {}, f.name), h('span', { class: 'ax-type' }, TYPE_LABEL[f.type] || f.type)),
      on && index > 0 && h('button', {
        class: 'ax-icon ax-up', type: 'button', title: `Move ${f.name} up`, 'aria-label': `Move ${f.name} up`, onclick: () => actions.moveField(f.id),
      }, '↑'),
    );
    const titleHint = { cards: 'card heading', accordion: 'question', text: 'heading' }[state.format];
    return h(
      'details',
      { class: 'ax-fields', open: state.fieldsOpen, ontoggle: (e) => { state.fieldsOpen = e.target.open; } },
      h('summary', {}, h('span', { class: 'ax-label' }, 'Fields'), h('span', { class: 'ax-muted' }, `${included.length} of ${state.table.fields.length}${titleHint && included[0] ? ` · ${included[0].name} is the ${titleHint}` : ''}`)),
      h('ul', {}, included.map((f, i) => item(f, true, i)), rest.map((f) => item(f, false))),
    );
  }

  function formatSection() {
    const { format, options } = state;
    const toggle = (key, label) => h('label', { class: 'ax-check' }, h('input', { type: 'checkbox', checked: options[key], onchange: (e) => actions.setOption(key, e.target.checked) }), h('span', {}, label));
    return h(
      'div',
      { class: 'ax-format' },
      h('span', { class: 'ax-label' }, 'Insert as'),
      h(
        'div',
        { class: 'ax-segment', role: 'radiogroup', 'aria-label': 'Insert as' },
        Object.entries(FORMATS).map(([key, def]) => h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(key === format), class: key === format ? 'ax-active' : '', title: def.hint, onclick: () => actions.setFormat(key),
        }, def.label)),
      ),
      h('p', { class: 'ax-muted ax-hint' }, FORMATS[format].hint),
      h('div', { class: 'ax-options' }, format === 'table' ? toggle('header', 'Header row') : toggle('labels', 'Field names before short values')),
    );
  }

  function renderPreview() {
    if (!els.preview) return;
    const html = actions.contentHtml();
    clear(els.preview);
    if (!html) {
      els.preview.append(h('p', { class: 'ax-muted ax-empty' }, 'Pick at least one record and one field.'));
      return;
    }
    const doc = h('div', { class: 'ax-doc' });
    // Built by lib/format.js, which escapes every Airtable value.
    doc.innerHTML = html;
    doc.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    els.preview.append(doc);
  }

  function renderFooter() {
    if (!els.footer) return;
    const count = state.selected.size;
    const ready = count > 0 && state.fields.length > 0 && !state.busy;
    const label = state.mode === 'demo' ? 'Insert (in EW)' : `Insert ${plural(count, 'record')}`;
    const inBlock = state.mode === 'ew' && state.live.blockIndex !== null && state.format !== 'text';
    fill(
      els.footer,
      inBlock && h('p', { class: 'ax-warn' }, 'Your cursor is inside a block. Click an empty line outside it to insert.'),
      h(
        'div',
        { class: 'ax-actions' },
        h('button', {
          class: 'ax-btn', type: 'button', disabled: !ready, onclick: actions.copy,
        }, 'Copy'),
        h('button', {
          class: 'ax-btn ax-primary', type: 'button', disabled: !ready || inBlock, onclick: actions.insert,
        }, label),
      ),
    );
  }

  function renderRecords() {
    if (!els.records) return;
    const shown = searchRecords(state.records, state.query);
    const picked = shown.filter((r) => state.selected.has(r.id)).length;
    const all = h('input', {
      type: 'checkbox', id: 'ax-all', checked: shown.length > 0 && picked === shown.length, onchange: (e) => actions.selectAll(e.target.checked),
    });
    all.indeterminate = picked > 0 && picked < shown.length;
    fill(
      els.records,
      h(
        'div',
        { class: 'ax-records-head' },
        h('label', { class: 'ax-check', for: 'ax-all' }, all, h('span', {}, `${state.selected.size} of ${plural(state.records.length, 'record')} selected`)),
        state.more && h('span', { class: 'ax-muted', title: 'Use a view in Airtable to narrow the list' }, `first ${state.records.length} only`),
      ),
      shown.length
        ? h('ul', { class: 'ax-record-list' }, shown.map(recordRow))
        : h('p', { class: 'ax-muted ax-empty' }, state.records.length ? 'No records match your search.' : 'This table or view has no records.'),
    );
    renderPreview();
    renderFooter();
  }

  function mainView() {
    const parts = [sourcePicker()];
    if (state.error) {
      parts.push(h('div', { class: 'ax-error', role: 'alert' }, state.error.message || String(state.error)));
    }
    if (state.table && !state.error) {
      parts.push(
        h('input', {
          class: 'ax-search', type: 'search', placeholder: `Search ${state.table.name}`, value: state.query, 'aria-label': 'Search records', oninput: (e) => actions.search(e.target.value),
        }),
        els.records = h('div', { class: 'ax-records' }),
        fieldsSection(),
        formatSection(),
        h('div', { class: 'ax-preview-wrap' }, h('span', { class: 'ax-label' }, 'Preview'), els.preview = h('div', { class: 'ax-preview' })),
      );
    } else if (!state.busy && !state.error && !state.bases.length && !state.sources.length) {
      parts.push(h('p', { class: 'ax-muted ax-empty' }, 'This connection cannot see any bases. Add bases to the token under Access in Airtable.'));
    }
    return h('section', { class: 'ax-main' }, parts);
  }

  function render() {
    els.records = null;
    els.preview = null;
    const body = [];
    if (state.view === 'connect') body.push(connectView());
    else if (state.view === 'main') body.push(mainView());
    els.busy = h('div', { class: 'ax-busy', role: 'status', hidden: !state.busy }, h('span', { class: 'ax-spinner' }), h('span', {}, state.busy));
    els.footer = state.view === 'main' && state.table && !state.error ? h('footer', { class: 'ax-foot' }) : null;
    fill(
      root,
      header(),
      state.mode === 'demo' && h('p', { class: 'ax-banner' }, 'Sample Northwind data. Open from Experience Workspace to use your own bases.'),
      els.busy,
      ...body,
      els.footer || '',
      els.toast || (els.toast = h('div', { class: 'ax-toast', role: 'status', hidden: true })),
    );
    renderRecords();
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
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 5000);
  }

  return {
    render, renderRecords, renderFooter, setBusy, toast,
  };
}
