/**
 * Demo mode: a pretend EW page (Northwind Bank, a fictional brand) on the left and the
 * real panel on the right. The demo host speaks the same protocol as EW, checks the
 * same things before a replace, and stands in for the assistant with canned edits, so
 * every feature can be tried without an EW project.
 */

import { h, escapeHtml } from './dom.js';
import {
  parseHtml, blockElements, blockName, classesOf,
} from './live.js';
import {
  ICON_TOKEN, applyOp, buildBlock, findField, fieldText, items, labelFields,
} from './model.js';
import { textToHtml } from './sanitize.js';

const MEDIA = '/tools/blockstudio/demo/media';
const ICONS = '/tools/blockstudio/demo/icons';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const img = (name, alt) => `<picture><img src="${MEDIA}/${name}.jpg" alt="${alt}"></picture>`;
const cta = (text, href) => `<p><strong><a href="${href}">${text}</a></strong></p>`;

const PAGE = `<main>
<div>
  <div class="hero">
    <div><div>${img('hero', 'A family outside their new home')}<h1>Savings that grow with you</h1><p>Open a Northwind savings account in minutes and watch every deposit earn more.</p>${cta('Open an account', '/products/savings/open')}</div></div>
  </div>
</div>
<div>
  <h2>Choose how you save</h2>
  <p>Three ways to put your money to work, from instant access to fixed terms.</p>
  <div class="carousel media-left">
    <div><div>${img('keys', 'Keys')}</div><div><p>Easy access</p><h3>Instant Saver</h3><p>Move money in and out whenever you like, with interest paid monthly.</p>${cta('Open Instant Saver', 'https://main--northwind--demo.aem.page/products/savings/instant')}</div></div>
    <div><div>${img('lock', 'lock.jpg')}</div><div><p>Fixed rate</p><h3>One-Year Fixed Bond</h3><p>Lock in 4.25% AER for twelve months and know exactly what you will earn.</p>${cta('Compare bonds', '')}</div></div>
    <div><div>${img('advisor', '')}</div><div><h3>Talk to a savings expert</h3><p>Not sure which account fits? Book a free fifteen-minute call with a Northwind savings advisor, who will look at your goals, your timeline and how often you need to reach your money, then suggest the right mix.</p>${cta('Book a call', '/contact/advisor')}</div></div>
    <div><div>theme</div><div>surface-light</div></div>
  </div>
</div>
<div>
  <h2>Why savers choose Northwind</h2>
  <div class="cards icons">
    <div><div><p>:lock:</p></div><div><h3>Safe and secure</h3><p>Two-step sign-in and instant alerts keep your savings safe.</p></div></div>
    <div><div><p>:phone:</p></div><div><h3>Save from your phone</h3><p>Move money, set goals and track interest in the Northwind app.</p></div></div>
    <div><div><p>:chart:</p></div><div><h3>Rates that keep up</h3><p>We review our rates every month, so your savings never fall behind.</p></div></div>
  </div>
</div>
<div>
  <div class="columns">
    <div><div>${img('switch', 'A moving van outside a house')}</div><div><h2>Switch in seven days</h2><p>We move your balance and close your old account for you, at no cost.</p><p><a href="/products/savings/switch">How switching works</a></p></div></div>
  </div>
  <div class="metadata">
    <div><div>Title</div><div>Savings accounts | Northwind Bank</div></div>
    <div><div>Description</div><div>Instant access and fixed-rate savings from Northwind Bank.</div></div>
  </div>
</div>
</main>`;

/** The demo site's rules sheet (block | field | label | max | required | hint | values). */
export const DEMO_RULES = [
  {
    block: 'carousel', field: 'theme', label: 'Background', required: 'yes', hint: 'The colour behind the slides.', values: 'No background=none|Light surface=surface-light|Brand tint=surface-tint|Dark surface=surface-dark',
  },
  {
    block: 'carousel', field: 'autoplay', label: 'Autoplay', values: 'Off=off|Every 5 seconds=5s|Every 8 seconds=8s',
  },
  { block: 'carousel', field: 'variants', values: 'media-left, media-right, full-width' },
  { block: 'carousel', field: 'items', label: 'Slide' },
  {
    block: 'carousel', field: 'description', max: '160', hint: 'One or two short sentences.',
  },
  { block: 'carousel', field: 'eyebrow', max: '24' },
  { block: 'cards', field: 'variants', values: 'icons, horizontal, compact' },
  { block: 'cards', field: 'items', label: 'Card' },
  { block: 'cards', field: 'icons', values: 'lock, piggy, phone, shield, chart, home, card, clock' },
  { block: '*', field: 'heading', max: '70' },
];

/* Canned assistant edits */

const ALT = {
  hero: 'A family with moving boxes outside their new house at sunset',
  keys: 'A hand holding a gold key beside a navy front door',
  lock: 'A calendar with a padlock, for a locked-in savings term',
  advisor: 'A Northwind advisor with a headset working at a computer',
  switch: 'A moving van driving toward a house',
};

const SPANISH = {
  'easy access': 'Acceso fácil',
  'instant saver': 'Ahorro Instantáneo',
  'move money in and out whenever you like, with interest paid monthly.': 'Mueve tu dinero cuando quieras, con intereses pagados cada mes.',
  'open instant saver': 'Abrir Ahorro Instantáneo',
  'fixed rate': 'Tipo fijo',
  'one-year fixed bond': 'Bono fijo a un año',
  'lock in 4.25% aer for twelve months and know exactly what you will earn.': 'Asegura un 4,25 % TAE durante doce meses y sabe exactamente cuánto ganarás.',
  'compare bonds': 'Comparar bonos',
  'talk to a savings expert': 'Habla con un experto en ahorro',
  'book a call': 'Reservar una llamada',
  'safe and secure': 'Seguro y protegido',
  'save from your phone': 'Ahorra desde tu móvil',
  'rates that keep up': 'Tipos que no se quedan atrás',
  'savings that grow with you': 'Ahorros que crecen contigo',
  'open an account': 'Abrir una cuenta',
};

const CLEARER = {
  'move money in and out whenever you like, with interest paid monthly.': 'Add or take out money at any time. We pay interest every month.',
  'lock in 4.25% aer for twelve months and know exactly what you will earn.': 'Get 4.25% AER, fixed for 12 months, so you know your return from day one.',
  'one-year fixed bond': '1-year fixed savings',
};

const PERSUASIVE = {
  'instant saver': 'Instant Saver: your money, any time',
  'open instant saver': 'Start saving today',
  'compare bonds': 'See this year’s best rate',
  'book a call': 'Book your free call',
  'talk to a savings expert': 'Get a free savings plan from an expert',
};

const BRIEF = [
  {
    eyebrow: 'Everyday saving', heading: 'Save a little every payday', text: 'Set up an automatic transfer and watch your balance grow without thinking about it.', button: 'Start saving',
  },
  {
    eyebrow: 'Fixed rate', heading: 'Lock in 4.25% for a year', text: 'Pick a one-year term and know your return from day one.', button: 'See fixed terms',
  },
  {
    eyebrow: 'Expert help', heading: 'Plan your savings with an expert', text: 'Book a free call and leave with a plan that fits your goals.', button: 'Book a call',
  },
  {
    eyebrow: 'Goals', heading: 'Save for what matters', text: 'Name a goal, set a date and we show you how much to put aside each month.', button: 'Set a goal',
  },
];

const sentence = (text) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
};

const STOP_WORDS = /\s+(?:and|or|with|for|to|the|a|an|of|so|who|which|that|in|on)$/i;

/** Shortens like an editor would: first sentence, then first clause, then whole words. */
function shorten(text, max) {
  const limit = Math.min(max || Infinity, Math.max(16, Math.round(text.length * 0.65)));
  const end = /[.!?]$/.test(text) ? '.' : '';
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0];
  if (first && first.length < text.length && first.length <= limit) return first;
  const clause = text.match(/^(.{12,}?)(?:,\s|\s(?:and|with|so|who|which)\s)/)?.[1];
  if (clause && clause.length <= limit) return `${clause}${end}`;
  let cut = text.slice(0, limit).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '');
  while (STOP_WORDS.test(cut)) cut = cut.replace(STOP_WORDS, '');
  return `${cut}${end}`;
}

function rewrite(req, text) {
  const key = text.toLowerCase();
  switch (req.action) {
    case 'shorten': return shorten(text, req.max);
    case 'translate': {
      if ((req.language || 'Spanish') === 'Spanish') return SPANISH[key] || `(ES) ${text}`;
      return `(${req.language}) ${text}`;
    }
    case 'grammar': return sentence(text.replace(/\bteh\b/gi, 'the').replace(/\s+([,.!?])/g, '$1'));
    case 'clearer': return CLEARER[key] || shorten(text);
    case 'persuasive': return PERSUASIVE[key] || `${text.replace(/[.!]$/, '')}${/[.!?]$/.test(text) ? ', with no fees.' : ''}`;
    case 'custom': {
      const rate = String(req.instruction || '').match(/\d+(?:\.\d+)?%/)?.[0];
      if (rate) return `${text.replace(/[.!]$/, '')}${/[.!?]$/.test(text) ? `, at ${rate} AER.` : ` at ${rate}`}`;
      return CLEARER[key] || shorten(text);
    }
    default: return text;
  }
}

function altFor(src) {
  const name = String(src || '').split('/').pop().replace(/\.[a-z]+$/i, '');
  return ALT[name] || 'A Northwind customer checking their savings on a phone';
}

function textProps(field, text) {
  if (field.type === 'heading') return { value: escapeHtml(text) };
  if (field.type === 'button') return { text };
  return { value: textToHtml(text) };
}

function briefEdit(model, doc) {
  const rows = model.mode === 'items' ? items(model) : items(model).slice(0, 1);
  rows.forEach((row, i) => {
    const copy = BRIEF[i % BRIEF.length];
    row.cells.forEach((cell) => {
      const labels = labelFields(cell.fields, doc);
      cell.fields.forEach((field, f) => {
        let props = null;
        if (field.type === 'heading') props = { value: escapeHtml(copy.heading) };
        else if (field.type === 'button') props = { text: copy.button };
        else if (field.type === 'image') props = { alt: altFor(field.src) };
        else if (field.type === 'text') {
          props = { value: textToHtml(labels[f] === 'Eyebrow' ? copy.eyebrow : copy.text) };
        }
        if (props) applyOp(model, { t: 'set', id: field.id, props }, doc);
      });
    });
  });
}

/**
 * What the demo assistant writes for a request: the block's HTML after the edit, or
 * null when the field is gone.
 */
export function cannedEdit(model, req, doc) {
  const next = structuredClone(model);
  if (req.kind === 'brief') {
    briefEdit(next, doc);
    return buildBlock(next, doc);
  }
  const hit = findField(next, req.fieldId);
  if (!hit) return null;
  const { field } = hit;
  const props = req.kind === 'alt'
    ? { alt: altFor(field.src) }
    : textProps(field, rewrite(req, fieldText(field, doc)));
  applyOp(next, { t: 'set', id: field.id, props }, doc);
  return buildBlock(next, doc);
}

/* The pretend page */

const UNSAFE = 'script, style, iframe, object, embed, link, meta, base, form, svg, math';

/** Parses one block from HTML and removes anything a real editor would never keep. */
function safeBlock(html) {
  const parsed = parseHtml(`<body>${html}</body>`);
  const nodes = [...parsed.body.childNodes].filter((n) => n.nodeType === 1
    || (n.nodeType === 3 && n.textContent.trim()));
  const [el] = nodes;
  if (nodes.length !== 1 || el.tagName !== 'DIV' || !classesOf(el).length) return null;
  el.querySelectorAll(UNSAFE).forEach((node) => node.remove());
  [el, ...el.querySelectorAll('*')].forEach((node) => {
    [...node.attributes].forEach(({ name, value }) => {
      // eslint-disable-next-line no-control-regex
      const url = value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
      if (name.startsWith('on') || name === 'style' || (['href', 'src', 'srcset'].includes(name)
        && /^(javascript|vbscript|data:text)/.test(url))) node.removeAttribute(name);
    });
  });
  return el;
}

function iconImg(name) {
  return h('img', {
    class: 'bs-demo-icon', src: `${ICONS}/${encodeURIComponent(name)}.svg`, alt: `${name} icon`,
  });
}

/** A copy of a block's content for display, with :icon: tokens shown as icons. */
function showContent(cell) {
  const copy = cell.cloneNode(true);
  copy.querySelectorAll('p').forEach((p) => {
    const match = p.textContent.trim().match(ICON_TOKEN);
    if (match && !p.children.length) p.replaceChildren(iconImg(match[1].toLowerCase()));
  });
  copy.querySelectorAll('span.icon').forEach((span) => {
    const name = classesOf(span).find((c) => c.startsWith('icon-'))?.slice(5);
    if (name) span.replaceWith(iconImg(name));
  });
  if (!copy.children.length) {
    const match = copy.textContent.trim().match(ICON_TOKEN);
    if (match) copy.replaceChildren(iconImg(match[1].toLowerCase()));
  }
  return copy;
}

/**
 * Creates the demo page and a host object shaped like the SDK EW passes to plugins.
 * @param {object} p
 * @param {() => ({index:number, html:string}|null)} p.simulate the assistant's edit
 */
export function createDemoHost({ simulate }) {
  const page = parseHtml(PAGE);
  const main = page.querySelector('main');
  let selectedIndex = 1;
  const liveListeners = new Set();
  const chatListeners = new Set();

  const docEl = h('div', { class: 'bs-demo-doc', 'aria-label': 'Demo page' });
  const chat = h('div', { class: 'bs-demo-chat', role: 'status' });
  const root = h(
    'div',
    { class: 'bs-demo-page' },
    h(
      'div',
      { class: 'bs-demo-bar' },
      h('span', { class: 'bs-tag' }, 'Demo'),
      h('span', {}, h('strong', {}, 'Northwind Bank'), ' · /products/savings'),
      h('span', { class: 'bs-demo-hint' }, 'Click a block to edit it in Block Studio →'),
    ),
    docEl,
  );

  const blocks = () => blockElements(page);

  function currentHtml() {
    const holder = page.createElement('div');
    holder.append(main.cloneNode(true));
    blockElements(holder).forEach((el, i) => el.setAttribute('data-block-index', String(i)));
    return `<body>${holder.innerHTML}</body>`;
  }

  const snapshot = () => ({
    html: currentHtml(), selection: { blockIndex: selectedIndex }, editable: true,
  });

  function emit() {
    const update = snapshot();
    liveListeners.forEach((cb) => cb(update));
  }

  function paint() {
    const all = blocks();
    const sections = [...main.children].map((section) => {
      const parts = [...section.children].map((el) => {
        const index = all.indexOf(el);
        if (index < 0 && blockName(el) !== 'metadata') return el.cloneNode(true);
        const [name, ...variants] = classesOf(el);
        const rows = [...el.children].map((row) => h('div', { class: 'bs-demo-row' }, [...row.children].map(showContent)));
        const label = `${name}${variants.length ? ` (${variants.join(', ')})` : ''}`;
        if (index < 0) {
          return h('div', { class: 'bs-demo-block bs-demo-meta' }, h('div', { class: 'bs-demo-name' }, label), rows);
        }
        const box = h('div', {
          class: `bs-demo-block${index === selectedIndex ? ' bs-demo-active' : ''}`,
          role: 'button',
          tabindex: '0',
          'aria-label': `Edit the ${label} block`,
          dataset: { index: String(index) },
        }, h('div', { class: 'bs-demo-name' }, label), rows);
        return box;
      });
      return h('section', {}, parts);
    });
    docEl.replaceChildren(...sections.flatMap((s, i) => (i ? [h('hr'), s] : [s])));
  }

  function select(index, scroll = true) {
    if (!blocks()[index]) return;
    selectedIndex = index;
    paint();
    if (scroll) docEl.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    emit();
  }

  docEl.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.preventDefault();
    const box = e.target.closest('.bs-demo-block[data-index]');
    if (box) select(Number(box.dataset.index), false);
  });
  docEl.addEventListener('keydown', (e) => {
    const box = e.target.closest('.bs-demo-block[data-index]');
    if (box && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      select(Number(box.dataset.index), false);
    }
  });

  function replaceAt(index, html) {
    const el = blocks()[index];
    const next = el && safeBlock(html);
    if (!next) return false;
    el.replaceWith(page.importNode(next, true));
    return true;
  }

  const failure = (error, message) => ({ ok: false, error, message });

  const actions = {
    subscribeLiveDocument(cb) {
      liveListeners.add(cb);
      setTimeout(() => { if (liveListeners.has(cb)) cb(snapshot()); }, 0);
      return () => liveListeners.delete(cb);
    },
    async sendHTML(html, opts = {}) {
      await wait(120);
      if (!opts.replace) return failure('unsupported', 'Only replace is supported in the demo.');
      const { expected } = opts;
      if (!expected || typeof expected.html !== 'string' || !Number.isInteger(expected.blockIndex)) {
        return failure('INVALID_EXPECTED', 'The expected page and block are required.');
      }
      if (expected.blockIndex !== selectedIndex) return failure('WRONG_SELECTION', 'The cursor is in another block.');
      if (expected.html !== currentHtml()) return failure('STALE_LIVE', 'The page changed since your last read.');
      if (!replaceAt(expected.blockIndex, html)) return failure('INVALID_HTML', 'Send exactly one block.');
      paint();
      emit();
      return {
        ok: true, html: currentHtml(), selection: { blockIndex: selectedIndex }, editable: true,
      };
    },
    async setPrompt() {
      chat.replaceChildren(h('span', { class: 'bs-spinner' }), h('span', {}, 'Demo assistant: editing the block…'));
      document.body.append(chat);
      setTimeout(() => {
        const edit = simulate();
        if (edit?.html && replaceAt(edit.index, edit.html)) {
          paint();
          emit();
        }
        chat.replaceChildren(h('span', {}, 'Demo assistant: done. In EW, your real assistant writes this.'));
        chatListeners.forEach((cb) => cb({ status: 'completed' }));
        setTimeout(() => chat.remove(), 2400);
      }, 1600);
      return { ok: true };
    },
    subscribeChatTurnCompleted(cb) {
      chatListeners.add(cb);
      return () => chatListeners.delete(cb);
    },
  };

  document.body.classList.add('bs-demo-mode');
  document.body.prepend(root);
  paint();

  return {
    context: { org: 'demo', repo: 'northwind', path: '/products/savings' },
    capabilities: {
      liveDocument: 1, sendHTMLReplace: 1, chatTurnCompleted: 1, dragDrop: 1,
    },
    actions,
    select,
  };
}
