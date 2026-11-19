import { h, fill } from './lib/dom.js';

const DOCS_URL = 'https://github.com/vipult2022/ew-shareready/tree/main/tools/figma#readme';
const MAX_MISSING = 8;

/* Fixed icon markup only; nothing from a design is ever put in through innerHTML. */
const ICONS = {
  mark: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path fill="currentColor" d="M9 8.5 16 12l-7 3.5z"/></svg>',
  refresh: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3"/></svg>',
  back: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m12 4-6 6 6 6"/></svg>',
  chevron: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m8 4 6 6-6 6"/></svg>',
  spark: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5Zm5.5 11c.2 1.7 1.1 2.6 2.8 2.8-1.7.2-2.6 1.1-2.8 2.8-.2-1.7-1.1-2.6-2.8-2.8 1.7-.2 2.6-1.1 2.8-2.8Z"/></svg>',
  insert: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M10 3v9m-4-4 4 4 4-4M4 16h12"/></svg>',
  alert: '<svg viewBox="0 0 18 18"><path fill="currentColor" d="M9 1.5 17 16H1zm-.9 5v4.2h1.8V6.5zm0 5.6V14h1.8v-1.9z"/></svg>',
  check: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="currentColor"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m5.5 9.2 2.3 2.3 4.7-4.9"/></svg>',
  out: '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13h-8.5V4.5H6.5"/></svg>',
  quote: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M3 11.5C3 7.6 5 5 8.3 4l.6 1.4C6.9 6.3 6 7.7 6 9.4h2.6V16H3zm8.4 0c0-3.9 2-6.5 5.3-7.5l.6 1.4c-2 .9-2.9 2.3-2.9 4H17V16h-5.6z"/></svg>',
  frame: '<svg viewBox="0 0 32 32"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 4v24M22 4v24M4 10h24M4 22h24"/></svg>',
};

const STATUS = {
  new: ['New', 'info'],
  updated: ['Updated', 'notice'],
  built: ['Built', 'positive'],
};

const BLOCK_HINT = {
  Hero: 'Hero block',
  Cards: 'Cards block',
  Columns: 'Columns block',
  Accordion: 'Accordion block',
  Table: 'Table block',
  Text: 'Default content',
};

function icon(name, cls = 'fg-i') {
  const span = h('span', { class: cls, 'aria-hidden': 'true' });
  span.innerHTML = ICONS[name];
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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const person = (sender) => String(sender || '').replace(/\s*\(.*\)$/, '');

function badge(status) {
  const [label, tone] = STATUS[status] || STATUS.new;
  return h('span', { class: `fg-badge fg-${tone}` }, label);
}

function firstLine(section) {
  const rows = (section.rows || []).flat(2);
  const items = [...(section.lead || []), ...(section.items || []), ...rows];
  const hit = items.find((i) => i.kind === 'heading') || items.find((i) => i.text);
  return hit?.text || '';
}

function missingLabel(item) {
  if (item.kind === 'image') return ['Picture', item.alt || item.name || item.image];
  if (item.kind === 'button') return ['Button', item.text];
  if (item.kind === 'heading') return [`H${item.level}`, item.text];
  return ['Text', item.text];
}

export default function createPanel(root, state, actions) {
  let toastTimer;
  const els = {};

  function header() {
    const { conn } = state;
    return h(
      'header',
      { class: 'fg-head' },
      h('span', { class: 'fg-mark' }, icon('mark')),
      h(
        'div',
        { class: 'fg-brand' },
        h('h1', {}, 'Figma handoff'),
        h('p', {}, conn ? conn.label : 'Designs sent from Figma'),
      ),
      conn && state.view === 'main' && h('button', {
        class: 'fg-icon-btn', type: 'button', title: 'Reload', 'aria-label': 'Reload', onclick: actions.refresh,
      }, icon('refresh')),
    );
  }

  function setupView() {
    return h(
      'section',
      { class: 'fg-setup' },
      h('span', { class: 'fg-empty-art' }, icon('frame')),
      h('h2', {}, 'Connect Figma to this site'),
      h('p', {}, 'Designers send a frame from Figma with the free “Send to Experience Workspace” plugin. Authors build the page here with the assistant or in one click, then check nothing was lost.'),
      h(
        'ol',
        { class: 'fg-steps' },
        h('li', {}, 'Deploy the small free Cloudflare worker from this repo. It is the inbox between Figma and the site.'),
        h('li', {}, 'In the site config, add a ', h('code', {}, 'figma'), ' sheet with ', h('code', {}, 'worker-url'), '.'),
        h('li', {}, 'Designers import the plugin in Figma and paste the worker address and team key.'),
      ),
      h('a', {
        class: 'fg-link', href: DOCS_URL, target: '_blank', rel: 'noopener',
      }, 'Step-by-step setup guide ', icon('out')),
      h('button', { class: 'fg-btn fg-primary', type: 'button', onclick: actions.tryDemo }, 'Try it with a sample design'),
    );
  }

  function thumb(key, cls) {
    const url = state.thumbs.get(key);
    const box = h('span', { class: cls, dataset: { thumb: key } });
    if (url) box.append(h('img', { src: url, alt: '' }));
    else box.append(icon('frame'));
    return box;
  }

  function listView() {
    if (!state.list.length) {
      return state.busy ? null : h(
        'div',
        { class: 'fg-empty' },
        h('span', { class: 'fg-empty-art' }, icon('frame')),
        h('h2', {}, 'No designs yet'),
        h('p', {}, 'When a designer sends a frame from Figma with “Send to Experience Workspace”, it shows up here for everyone on the site.'),
        h('a', {
          class: 'fg-link', href: DOCS_URL, target: '_blank', rel: 'noopener',
        }, 'How designers send frames ', icon('out')),
      );
    }
    return [
      h('div', { class: 'fg-section-head' }, h('h2', {}, 'Designs for this site'), h('span', { class: 'fg-count' }, String(state.list.length))),
      h('ul', { class: 'fg-list' }, state.list.map((item) => h(
        'li',
        {},
        h(
          'button',
          { class: 'fg-row', type: 'button', onclick: () => actions.openDesign(item.id) },
          thumb(`${item.id}|${item.sent}`, 'fg-row-thumb'),
          h(
            'span',
            { class: 'fg-row-text' },
            h('span', { class: 'fg-row-top' }, h('strong', {}, item.name || 'Untitled frame'), badge(item.status)),
            item.path && h('span', { class: 'fg-mono' }, item.path),
            h('span', { class: 'fg-muted' }, [
              item.sender && `${person(item.sender)} · `,
              `sent ${ago(item.sent)}`,
            ]),
          ),
          icon('chevron', 'fg-i fg-chevron'),
        ),
      ))),
    ];
  }

  function designCard(handoff, model) {
    const meta = [handoff.file, handoff.page].filter(Boolean).join(' / ');
    const stats = [
      plural(model.stats.sections, 'section'),
      plural(model.stats.texts, 'text'),
      plural(model.stats.images, 'picture'),
      plural(model.stats.buttons, 'button'),
    ];
    return h(
      'article',
      { class: 'fg-card fg-design' },
      h(
        'div',
        { class: 'fg-shot' },
        thumb(`${handoff.id}|${handoff.sent}`, 'fg-shot-img'),
        handoff.width > 0 && h('span', { class: 'fg-size' }, `${Math.round(handoff.width)} × ${Math.round(handoff.height)}`),
      ),
      h(
        'div',
        { class: 'fg-design-body' },
        h('div', { class: 'fg-row-top' }, h('h2', {}, handoff.name || 'Untitled frame'), badge(handoff.status)),
        h('p', { class: 'fg-muted' }, [
          handoff.sender && `From ${person(handoff.sender)} · `,
          `sent ${ago(handoff.sent)}`,
        ]),
        meta && h('p', { class: 'fg-muted fg-small' }, meta),
        h('ul', { class: 'fg-chips' }, stats.map((s) => h('li', {}, s))),
      ),
    );
  }

  function noteCard(handoff) {
    if (!handoff.note) return null;
    return h(
      'blockquote',
      { class: 'fg-note' },
      icon('quote'),
      h('div', {}, h('p', {}, handoff.note), handoff.sender && h('cite', {}, person(handoff.sender))),
    );
  }

  function warnings(model) {
    if (!model.warnings.length) return null;
    return h(
      'div',
      { class: 'fg-alert fg-notice', role: 'note' },
      icon('alert'),
      h('ul', {}, model.warnings.map((w) => h('li', {}, w.text))),
    );
  }

  function outline(model) {
    return h(
      'section',
      { class: 'fg-block' },
      h('h3', { class: 'fg-label' }, 'Page outline'),
      h('ol', { class: 'fg-outline' }, model.sections.map((s, i) => h(
        'li',
        {},
        h('span', { class: 'fg-num' }, String(i + 1)),
        h(
          'span',
          { class: 'fg-outline-text' },
          h('span', { class: 'fg-row-top' }, h('strong', {}, s.name), h('span', { class: `fg-tag${s.block === 'Text' ? ' fg-tag-plain' : ''}` }, BLOCK_HINT[s.block] || s.block)),
          firstLine(s) && h('span', { class: 'fg-muted fg-clip' }, firstLine(s)),
        ),
      ))),
    );
  }

  function promptBox() {
    const pre = h('pre', { class: 'fg-prompt' });
    const box = h(
      'details',
      { class: 'fg-details' },
      h('summary', {}, 'What the assistant gets'),
      h('p', { class: 'fg-muted fg-small' }, 'The exact copy, the suggested blocks and the picture URLs, with rules to keep every word as designed.'),
      pre,
      h('button', { class: 'fg-btn fg-quiet', type: 'button', onclick: actions.copyPrompt }, 'Copy request'),
    );
    box.addEventListener('toggle', () => { if (box.open) pre.textContent = actions.prompt(); });
    return box;
  }

  function createSection() {
    const { created } = state;
    if (created) {
      return h(
        'div',
        { class: 'fg-alert fg-positive', role: 'status' },
        icon('check'),
        h(
          'div',
          {},
          h('strong', {}, `Created ${created.path}`),
          h('p', {}, h('a', {
            class: 'fg-link', href: created.url, target: '_blank', rel: 'noopener',
          }, 'Open it in Experience Workspace ', icon('out'))),
        ),
      );
    }
    return h(
      'form',
      { class: 'fg-block fg-create', onsubmit: (e) => { e.preventDefault(); actions.createPage(); } },
      h('label', { class: 'fg-label', for: 'fg-path' }, 'Or create it as a new page'),
      h(
        'div',
        { class: 'fg-inline' },
        h('input', {
          id: 'fg-path', class: 'fg-input', type: 'text', value: state.path, spellcheck: 'false', autocomplete: 'off', oninput: (e) => actions.setPath(e.target.value),
        }),
        h('button', { class: 'fg-btn', type: 'submit', disabled: !!state.busy }, 'Create page'),
      ),
      h('p', { class: 'fg-muted fg-small' }, 'Pictures are copied into the site first. An existing page is never overwritten.'),
    );
  }

  function ring(score) {
    const r = 26;
    const c = 2 * Math.PI * r;
    let tone = 'negative';
    if (score >= 90) tone = 'positive';
    else if (score >= 60) tone = 'notice';
    const span = h('span', { class: `fg-ring fg-${tone}`, role: 'img', 'aria-label': `${score}% of the design is on the page` });
    span.innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="fg-ring-bg"/><circle cx="32" cy="32" r="${r}" class="fg-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - score / 100)).toFixed(1)}"/></svg>`;
    span.append(h('strong', {}, `${score}%`));
    return span;
  }

  function bar(label, group) {
    const pct = group.total ? Math.round((group.found / group.total) * 100) : 100;
    return h(
      'li',
      { class: 'fg-bar' },
      h('span', {}, label),
      h('span', { class: 'fg-track' }, h('span', { class: pct === 100 ? 'fg-fill fg-full' : 'fg-fill', style: { width: `${pct}%` } })),
      h('span', { class: 'fg-muted' }, `${group.found}/${group.total}`),
    );
  }

  function checkBody() {
    const { check, current } = state;
    if (!check) {
      return h('p', { class: 'fg-muted' }, state.mode === 'da' ? 'Read this page to compare it with the design.' : 'Open a page to compare it with the design.');
    }
    const source = {
      live: 'Compared with the page as you edit it.',
      saved: 'Compared with the last saved version of this page.',
      sample: 'Sample: compared with a page an assistant built from this design.',
    }[check.source];
    let summary = `${check.found} of ${check.total} things from the design are on this page.`;
    if (check.empty) summary = 'Nothing from the design is on this page yet.';
    else if (!check.missing.length) summary = 'Everything from the design is on this page.';
    const shown = check.missing.slice(0, MAX_MISSING);
    const built = current.handoff.status === 'built';
    return [
      h('div', { class: 'fg-score' }, ring(check.score), h('div', {}, h('strong', {}, summary), h('p', { class: 'fg-muted fg-small' }, source))),
      h(
        'ul',
        { class: 'fg-bars' },
        bar('Text', check.groups.texts),
        check.picturesUnknown
          ? h('li', { class: 'fg-bar fg-muted fg-small' }, 'Pictures are checked after they are copied into the site (Build or Insert).')
          : bar('Pictures', check.groups.images),
        bar('Buttons', check.groups.buttons),
      ),
      shown.length > 0 && h(
        'div',
        { class: 'fg-missing' },
        h('h4', { class: 'fg-label' }, 'Missing from the page'),
        h('ul', {}, shown.map((item) => {
          const [kind, text] = missingLabel(item);
          return h('li', {}, h('span', { class: 'fg-tag fg-tag-plain' }, kind), h('span', { class: 'fg-clip' }, text));
        })),
        check.missing.length > shown.length && h('p', { class: 'fg-muted fg-small' }, `and ${check.missing.length - shown.length} more`),
      ),
      check.notes.length > 0 && h(
        'div',
        { class: 'fg-alert fg-info' },
        icon('alert'),
        h('ul', {}, [...new Set(check.notes)].map((n) => h('li', {}, n))),
      ),
      h(
        'div',
        { class: 'fg-inline fg-end' },
        state.mode !== 'ew' && h('button', { class: 'fg-btn fg-quiet', type: 'button', onclick: actions.checkAgain }, state.mode === 'da' ? 'Read this page' : 'Check again'),
        built
          ? h('button', { class: 'fg-btn fg-quiet', type: 'button', onclick: actions.reopen }, 'Not built yet')
          : h('button', {
            class: `fg-btn ${check.score >= 90 ? 'fg-positive-btn' : ''}`, type: 'button', disabled: !!state.busy, onclick: actions.markBuilt,
          }, `Mark built${current.handoff.sender ? ` and tell ${person(current.handoff.sender).split(' ')[0]}` : ''}`),
      ),
      built && h('p', { class: 'fg-muted fg-small fg-right' }, 'The designer sees “Built” and a link to the page in Figma.'),
    ];
  }

  function renderCheck() {
    if (els.check) fill(els.check, checkBody());
  }

  function detailView() {
    const { handoff, model } = state.current;
    els.check = h('div', { class: 'fg-check-body' });
    return [
      h('button', { class: 'fg-back', type: 'button', onclick: actions.back }, icon('back'), 'All designs'),
      designCard(handoff, model),
      noteCard(handoff),
      warnings(model),
      outline(model),
      promptBox(),
      createSection(),
      h('section', { class: 'fg-card fg-check' }, h('h3', { class: 'fg-label' }, 'Design check'), els.check),
    ];
  }

  function renderFooter() {
    if (!els.footer) return;
    const inBlock = state.mode === 'ew' && state.live.blockIndex !== null;
    const off = !!state.busy || inBlock || !state.live.editable;
    fill(
      els.footer,
      inBlock && h('p', { class: 'fg-foot-note' }, 'Your cursor is inside a block. Click an empty line outside it to build here.'),
      !state.live.editable && h('p', { class: 'fg-foot-note' }, 'You cannot edit this page.'),
      h(
        'div',
        { class: 'fg-actions' },
        h('button', {
          class: 'fg-btn', type: 'button', disabled: off, onclick: actions.insert, title: 'Insert the design as blocks at the cursor, without the assistant',
        }, icon('insert'), 'Insert'),
        h('button', {
          class: 'fg-btn fg-primary fg-grow', type: 'button', disabled: off, onclick: actions.buildWithAi,
        }, icon('spark'), 'Build with AI'),
      ),
    );
  }

  function render() {
    els.check = null;
    const body = [];
    if (state.view === 'setup') body.push(setupView());
    else if (state.view === 'main') {
      body.push(state.current ? detailView() : listView());
      if (state.error) body.push(h('div', { class: 'fg-alert fg-negative', role: 'alert' }, icon('alert'), h('p', {}, state.error.message || String(state.error))));
    }
    els.busy = h('div', { class: 'fg-busy', role: 'status', hidden: !state.busy }, h('span', { class: 'fg-spinner' }), h('span', {}, state.busy));
    els.footer = state.view === 'main' && state.current ? h('footer', { class: 'fg-foot' }) : null;
    fill(
      root,
      header(),
      state.mode === 'demo' && h('p', { class: 'fg-banner' }, 'Sample Northwind design. Open from Experience Workspace to see what your designers send.'),
      els.busy,
      h('div', { class: 'fg-body' }, body),
      els.footer || '',
      els.toast || (els.toast = h('div', { class: 'fg-toast', role: 'status', hidden: true })),
    );
    renderCheck();
    renderFooter();
  }

  function setBusy(text) {
    state.busy = text;
    if (!els.busy) return;
    els.busy.hidden = !text;
    els.busy.lastChild.textContent = text;
    renderFooter();
  }

  function setThumb(key, url) {
    root.querySelectorAll('[data-thumb]').forEach((box) => {
      if (box.dataset.thumb === key) fill(box, h('img', { src: url, alt: '' }));
    });
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
  }

  return {
    render,
    renderCheck,
    renderFooter,
    setBusy,
    setThumb,
    toast,
    scrollTop: () => window.scrollTo(0, 0),
  };
}
