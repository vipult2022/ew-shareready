import { h, fill } from './lib/dom.js';
import {
  cleanFlow, cleanInline, textToHtml, safeUrl,
} from './lib/sanitize.js';
import {
  counter, limitFor, formatBytes, healthText, LIMITS,
} from './lib/check.js';
import { fieldText, toClass } from './lib/model.js';
import { TEXT_ACTIONS, LANGUAGES } from './lib/ai.js';
import { fieldRule } from './lib/rules.js';

const DOCS_URL = 'https://github.com/vipult2022/ew-shareready/tree/main/tools/blockstudio#readme';

/* Fixed icon markup only; page content is never put in through innerHTML unsanitized. */
const ICONS = {
  mark: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M7 8.5h5M7 12h10M7 15.5h7"/><circle cx="17" cy="8.5" r="1.6" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M7.5 5 4 8.5 7.5 12M4.5 8.5H12a4 4 0 0 1 0 8H9"/></svg>',
  redo: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12.5 5 16 8.5 12.5 12M15.5 8.5H8a4 4 0 0 0 0 8h3"/></svg>',
  chevron: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>',
  up: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"/></svg>',
  down: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M13 4.5a1 1 0 0 0-1-1H5a1.5 1.5 0 0 0-1.5 1.5v7a1 1 0 0 0 1 1"/></svg>',
  trash: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 6h12M8 6V4.5h4V6m-6.5 0 .7 9.6a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4L14.5 6M8.5 9v5M11.5 9v5"/></svg>',
  plus: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M10 4.5v11M4.5 10h11"/></svg>',
  close: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="m5.5 5.5 9 9m0-9-9 9"/></svg>',
  spark: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5Zm5.5 11c.2 1.7 1.1 2.6 2.8 2.8-1.7.2-2.6 1.1-2.8 2.8-.2-1.7-1.1-2.6-2.8-2.8 1.7-.2 2.6-1.1 2.8-2.8Z"/></svg>',
  alert: '<svg viewBox="0 0 18 18"><path fill="currentColor" d="M9 1.5 17 16H1zm-.9 5v4.2h1.8V6.5zm0 5.6V14h1.8v-1.9z"/></svg>',
  error: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="currentColor"/><path fill="#fff" d="M8.1 4.5h1.8v5.2H8.1zm0 6.6h1.8V13H8.1z"/></svg>',
  check: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="currentColor"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m5.5 9.2 2.3 2.3 4.7-4.9"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.8" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4"/></svg>',
  upload: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M10 13V3.5M6 7.5l4-4 4 4M4 13.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2"/></svg>',
  bold: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 4h5a3 3 0 0 1 0 6H6zm0 6h5.8a3 3 0 0 1 0 6H6z"/></svg>',
  italic: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.5 4h7M4.5 16h7M12 4l-4 12"/></svg>',
  link: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1m1.5 3.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/></svg>',
  ul: '<svg viewBox="0 0 20 20"><circle cx="4.5" cy="5.5" r="1.3" fill="currentColor"/><circle cx="4.5" cy="10" r="1.3" fill="currentColor"/><circle cx="4.5" cy="14.5" r="1.3" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5"/></svg>',
  ol: '<svg viewBox="0 0 20 20"><path fill="currentColor" d="M3.6 4h1.3v4H3.9V5.2l-.6.2V4.5zM3 12.4c0-1 .8-1.4 1.5-1.4s1.4.4 1.4 1.1c0 .6-.4 1-1 1.4l-.6.4h1.7v.9H3v-.8l1.3-1c.4-.3.6-.5.6-.8 0-.2-.2-.4-.5-.4s-.5.2-.5.6z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8 6h8.5M8 13h8.5"/></svg>',
  clear: '<svg viewBox="0 0 20 20"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M5 4.5h10M10 4.5 7.5 15.5M12 12l4 4m0-4-4 4"/></svg>',
  out: '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13h-8.5V4.5H6.5"/></svg>',
  cursor: '<svg viewBox="0 0 48 48"><rect x="6" y="8" width="36" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M12 16h14M12 22h20M12 28h9"/><path fill="currentColor" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="m30 24 12 5-5 1.8 3.6 5-2.4 1.7-3.6-5-3.2 4z"/></svg>',
};

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
const BUTTON_STYLES = [
  ['primary', 'Primary'], ['secondary', 'Secondary'], ['link', 'Plain link'],
];

function icon(name, cls = 'bs-i') {
  const span = h('span', { class: cls, 'aria-hidden': 'true' });
  span.innerHTML = ICONS[name];
  return span;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const title = (text) => String(text || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const issueIcon = (level) => icon(level === 'error' ? 'error' : 'alert', `bs-i bs-${level}`);

function iconBtn(name, label, onclick, extra = {}) {
  return h('button', {
    type: 'button', class: `bs-icon-btn ${extra.class || ''}`.trim(), 'aria-label': label, title: label, onclick, disabled: extra.disabled,
  }, icon(name));
}

const tiny = (name, label, onclick, disabled) => iconBtn(name, label, onclick, { class: 'bs-tiny', disabled });

/** Keeps the caret where it was when an editor is rebuilt. */
function captureFocus() {
  const el = document.activeElement;
  const key = el?.dataset?.key;
  if (!key) return null;
  const state = { key };
  if (typeof el.selectionStart === 'number') {
    state.start = el.selectionStart;
    state.end = el.selectionEnd;
  }
  return state;
}

function restoreFocus(root, saved) {
  if (!saved) return;
  const el = root.querySelector(`[data-key="${CSS.escape(saved.key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof saved.start === 'number' && typeof el.setSelectionRange === 'function') {
    try {
      el.setSelectionRange(saved.start, saved.end);
    } catch {
      // Some input types have no selection.
    }
  } else if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export default function createPanel(root, state, on) {
  let binds = [];
  let shape = '';
  let openedBlock = '';
  let toastTimer;
  let menu = null;
  const ui = {
    head: h('header', { class: 'bs-head' }),
    status: h('div', { class: 'bs-status', role: 'status', 'aria-live': 'polite' }),
    body: h('div', { class: 'bs-body' }),
    toast: h('div', { class: 'bs-toast', role: 'status', 'aria-live': 'polite' }),
  };
  fill(root, ui.head, ui.status, ui.body, ui.toast);

  const doc = document.implementation.createHTMLDocument('');
  const view = () => state.view || { options: [], groups: [] };
  const groupOf = (gi) => view().groups[gi];
  const slotOf = (key) => {
    const [gi, c, k] = key.split(':').map(Number);
    return groupOf(gi)?.cells[c]?.[k] || null;
  };
  const issuesFor = (target) => (state.issues || []).filter((issue) => issue.target === target);
  const ruleFor = (slot) => fieldRule(state.rules, slot.label, slot.type);
  const locked = () => !state.editable;

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('bs-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('bs-show'), 3200);
  }

  /* Header and status */

  // The header and status are updated in place: an editor's blur re-renders the panel
  // between mousedown and click, and a rebuilt button would lose the click.
  const top = {};
  function renderHead() {
    if (!top.sub) {
      top.sub = h('p', { class: 'bs-sub' });
      top.undo = iconBtn('undo', 'Undo', () => on.undo());
      top.redo = iconBtn('redo', 'Redo', () => on.redo());
      top.tools = h('div', { class: 'bs-head-tools' }, top.undo, top.redo);
      fill(
        ui.head,
        h('div', { class: 'bs-mark' }, icon('mark')),
        h('div', { class: 'bs-brand' }, h('h1', {}, 'Block Studio'), top.sub),
        top.tools,
      );
    }
    const target = state.target && state.model;
    top.sub.textContent = target
      ? `${title(state.model.name)}${state.model.variants.length ? ` (${state.model.variants.join(', ')})` : ''}`
      : 'Edit any block as a simple form';
    top.tools.hidden = !target;
    top.undo.disabled = !state.history?.canUndo || locked();
    top.redo.disabled = !state.history?.canRedo || locked();
  }

  let statusKey = '';
  let statusFns = [];
  function renderStatus() {
    const { status } = state;
    ui.status.className = `bs-status bs-status-${status?.kind || 'idle'}`;
    if (!status || status.kind === 'idle' || !state.target) {
      statusKey = '';
      statusFns = [];
      fill(ui.status);
      return;
    }
    statusFns = (status.actions || []).map(([, fn]) => fn);
    const labels = (status.actions || []).map(([label, , primary]) => [label, !!primary]);
    const key = JSON.stringify([status.kind, status.text, labels]);
    if (key === statusKey) return;
    statusKey = key;
    const actions = (status.actions || []).map(([label, , primary], i) => h('button', {
      type: 'button', class: `bs-btn bs-small-btn ${primary ? 'bs-primary' : ''}`, onclick: () => statusFns[i]?.(),
    }, label));
    let glyph = null;
    if (status.kind === 'saved') glyph = icon('check', 'bs-i bs-positive');
    else if (status.kind === 'saving' || status.kind === 'pending') glyph = h('span', { class: 'bs-dot' });
    else if (['conflict', 'error'].includes(status.kind)) glyph = icon('alert', 'bs-i bs-notice');
    fill(ui.status, glyph, h('span', { class: 'bs-status-text' }, status.text), actions.length ? h('span', { class: 'bs-status-actions' }, actions) : null);
  }

  /* Issues */

  function reveal(target, prop) {
    const { groups } = view();
    const gi = groups.findIndex((group) => target === `row:${group.row.id}`
      || target.startsWith(`slot:${group.row.id}:`)
      || group.cells.flat().some((slot) => slot.field?.id === target));
    if (gi >= 0 && groups[gi].kind === 'item' && !state.open.has(groups[gi].n)) {
      state.open.add(groups[gi].n);
      // eslint-disable-next-line no-use-before-define
      render(true);
    }
    const missing = target.startsWith('option-missing:') ? target.slice(15) : '';
    const definedKey = missing && state.rules?.optionDefs?.has(missing);
    if (missing && !definedKey) {
      state.addingOption = missing;
      // eslint-disable-next-line no-use-before-define
      render(true);
    }
    const fallback = definedKey ? `option:${missing}` : target.replace(/^option-missing:.*/, 'add-option');
    const el = ui.body.querySelector(`[data-target="${CSS.escape(target)}"]`)
      || ui.body.querySelector(`[data-target="${CSS.escape(fallback)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('bs-flash');
    // Restart the highlight animation.
    el.getBoundingClientRect();
    el.classList.add('bs-flash');
    const focusable = el.matches('[data-key]') ? el
      : (prop && el.querySelector(`[data-key$=":${prop}"]`))
        || el.querySelector('[data-key]:not([data-key$=":ai"]), input, select')
        || el.querySelector('[data-key], button');
    focusable?.focus({ preventScroll: true });
  }

  function renderHealth(box) {
    const issues = state.issues || [];
    const errors = issues.filter((i) => i.level === 'error').length;
    let tone = 'positive';
    if (errors) tone = 'negative';
    else if (issues.length) tone = 'notice';
    const toggle = h('button', {
      type: 'button',
      class: `bs-health bs-health-${tone}`,
      'aria-expanded': String(!!state.showIssues),
      disabled: !issues.length,
      onclick: () => {
        state.showIssues = !state.showIssues;
        renderHealth(box);
      },
    }, icon(issues.length ? 'alert' : 'check'), h('span', { class: 'bs-health-text' }, healthText(issues)), issues.length ? icon('chevron', 'bs-i bs-chev') : null);
    const list = state.showIssues && issues.length ? h('ul', { class: 'bs-issues' }, issues.map((issue) => h('li', {}, h('button', {
      type: 'button', class: 'bs-issue', onclick: () => reveal(issue.target, issue.prop),
    }, issueIcon(issue.level), h('span', {}, h('strong', {}, issue.where), ' ', issue.message))))) : null;
    fill(box, toggle, list);
  }

  /* AI */

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function aiMenu(anchor, slot, gi) {
    if (menu && menu.dataset.for === anchor.dataset.key) {
      closeMenu();
      return;
    }
    closeMenu();
    const group = groupOf(gi);
    const send = (action, extra = {}) => {
      closeMenu();
      const current = slotOf(anchor.dataset.slot);
      if (!current?.field) return;
      on.ai({
        kind: current.field.type === 'image' ? 'alt' : 'field',
        action,
        fieldId: current.field.id,
        where: group.kind === 'item' || view().groups.length > 1 ? group.title : '',
        label: current.label,
        text: current.field.type === 'image' ? current.field.alt : fieldText(current.field, doc),
        alt: current.field.alt,
        max: limitFor(current, state.rules),
        ...extra,
      });
    };
    const extraBox = h('div', { class: 'bs-menu-extra' });
    const items = slot.type === 'image'
      ? [h('button', { type: 'button', role: 'menuitem', onclick: () => send('alt') }, 'Suggest alt text')]
      : TEXT_ACTIONS.map(({ id, label }) => h('button', {
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          if (id === 'translate') {
            const select = h('select', { class: 'bs-input', 'aria-label': 'Language' }, LANGUAGES.map((lang) => h('option', {}, lang)));
            fill(extraBox, select, h('button', { type: 'button', class: 'bs-btn bs-primary bs-small-btn', onclick: () => send('translate', { language: select.value }) }, 'Translate'));
            select.focus();
          } else if (id === 'custom') {
            const input = h('input', {
              class: 'bs-input', placeholder: 'e.g. Mention the 4.25% rate', 'aria-label': 'Instruction',
            });
            const go = () => input.value.trim() && send('custom', { instruction: input.value });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
            fill(extraBox, input, h('button', { type: 'button', class: 'bs-btn bs-primary bs-small-btn', onclick: go }, 'Ask'));
            input.focus();
          } else send(id);
        },
      }, label));
    menu = h('div', { class: 'bs-menu', role: 'menu', dataset: { for: anchor.dataset.key } }, h('p', { class: 'bs-menu-title' }, icon('spark'), 'Ask the assistant'), items, extraBox);
    anchor.closest('.bs-field').append(menu);
    menu.querySelector('button')?.focus();
  }

  function renderAiBanner(box) {
    const { ai } = state;
    if (ai?.busy) {
      fill(box, h('div', { class: 'bs-alert bs-info' }, h('span', { class: 'bs-spinner' }), h('span', {}, ai.slow
        ? 'The assistant is still working. You can keep editing other fields.'
        : `The assistant is editing ${ai.label}…`)));
    } else if (ai?.undo) {
      fill(box, h('div', { class: 'bs-alert bs-positive' }, icon('spark'), h('span', { class: 'bs-grow' }, `The assistant changed ${ai.undo.label}.`), h('button', {
        type: 'button', class: 'bs-btn bs-small-btn', onclick: () => on.undoAi(),
      }, 'Undo AI change')));
    } else fill(box);
  }

  /* Field editors */

  function fieldHead(slot, key, gi, parts = {}) {
    const rule = ruleFor(slot);
    const label = rule.label || slot.label;
    const id = `bs-${key.replaceAll(':', '-')}`;
    const count = h('span', { class: 'bs-counter', 'aria-live': 'off' });
    const tools = [];
    if (state.ai?.available && slot.field && slot.type !== 'raw' && slot.type !== 'icon' && !locked()) {
      tools.push(h('button', {
        type: 'button',
        class: 'bs-icon-btn bs-ai-btn',
        'aria-label': `Ask the assistant about ${label}`,
        title: 'Ask the assistant',
        dataset: { key: `${key}:ai`, slot: key },
        onclick: (e) => aiMenu(e.currentTarget, slot, gi),
      }, icon('spark')));
    }
    if (slot.field && slot.type !== 'heading' && !locked() && parts.removable !== false) {
      tools.push(iconBtn('close', `Remove ${label}`, () => {
        const current = slotOf(key);
        if (current?.field) on.removeField(current.field.id);
      }, { class: 'bs-remove' }));
    }
    return {
      id,
      count,
      el: h('div', { class: 'bs-field-head' }, h('label', { class: 'bs-label', for: id, id: `${id}-label` }, label), count, tools),
      hint: rule.hint ? h('p', { class: 'bs-hint' }, rule.hint) : null,
    };
  }

  function updateCount(el, length, max) {
    const { state: tone } = counter(length, max);
    el.className = `bs-counter bs-${tone}`;
    el.textContent = max ? `${length}/${max}` : '';
  }

  function issuesBox(target) {
    const box = h('ul', { class: 'bs-field-issues' });
    return {
      box,
      update: () => fill(box, issuesFor(target).map((issue) => h('li', { class: `bs-${issue.level}` }, issueIcon(issue.level), issue.message))),
    };
  }

  // What each editor last sent. A focused editor is left alone while the model holds that
  // value (so the caret does not jump), but undo, AI and page changes still reach it.
  const sent = new WeakMap();
  function sync(el, value, prop = 'value') {
    const next = value ?? '';
    if (el[prop] === next) return;
    const focused = document.activeElement === el;
    if (focused && sent.get(el) === next) return;
    el[prop] = next;
    sent.set(el, next);
    if (focused && el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  }
  const syncRich = (editor, value) => sync(editor, value, 'innerHTML');

  function setField(key, props, commit) {
    const slot = slotOf(key);
    if (slot?.field) on.setField(slot.field.id, props, commit);
  }

  function richEditor(slot, key, { single, compact, labelId }) {
    const el = h('div', {
      class: `bs-rich ${single ? 'bs-single' : ''} ${compact ? 'bs-compact' : ''}`,
      contenteditable: locked() ? 'false' : 'true',
      role: 'textbox',
      'aria-multiline': single ? 'false' : 'true',
      'aria-labelledby': labelId,
      id: labelId.replace(/-label$/, ''),
      dataset: { key: `${key}:value` },
    });
    el.innerHTML = slot.field.value || '';
    const clean = (html) => (single ? cleanInline(html, doc) : cleanFlow(html, doc));
    el.addEventListener('input', () => {
      const value = clean(el.innerHTML);
      sent.set(el, value);
      setField(key, { value });
    });
    el.addEventListener('blur', () => {
      const value = clean(el.innerHTML);
      if (el.innerHTML !== value) el.innerHTML = value;
      sent.set(el, value);
      setField(key, { value }, true);
    });
    el.addEventListener('keydown', (e) => {
      if ((single || compact) && e.key === 'Enter') e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) on.redo();
        else on.undo();
      }
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      let insert = html ? clean(html) : textToHtml(text);
      if (single) insert = cleanInline(insert, doc);
      document.execCommand('insertHTML', false, insert);
    });
    return el;
  }

  function toolbar(editor, key, { lists = true } = {}) {
    let saved = null;
    const linkBox = h('div', { class: 'bs-link-form', hidden: true });
    const exec = (cmd, value) => {
      editor.focus();
      document.execCommand(cmd, false, value);
      editor.dispatchEvent(new Event('input'));
    };
    const tool = (name, label, cmd) => h('button', {
      type: 'button',
      class: 'bs-tool',
      'aria-label': label,
      title: label,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => exec(cmd),
    }, icon(name));
    const openLink = () => {
      const selection = window.getSelection();
      if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
        toast('Select some text in the field first.');
        return;
      }
      saved = selection.getRangeAt(0).cloneRange();
      const existing = selection.anchorNode.parentElement?.closest('a');
      const input = h('input', {
        class: 'bs-input', type: 'url', placeholder: 'https://… or /page', 'aria-label': 'Link URL', value: existing?.getAttribute('href') || '',
      });
      const apply = () => {
        const url = safeUrl(input.value);
        linkBox.hidden = true;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(saved);
        if (!input.value.trim()) exec('unlink');
        else if (!url) toast('That link type is not allowed.');
        else exec('createLink', url);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
        if (e.key === 'Escape') linkBox.hidden = true;
      });
      fill(linkBox, input, h('button', { type: 'button', class: 'bs-btn bs-primary bs-small-btn', onclick: apply }, 'Apply'), existing ? h('button', {
        type: 'button',
        class: 'bs-btn bs-small-btn',
        onclick: () => {
          input.value = '';
          apply();
        },
      }, 'Remove') : null);
      linkBox.hidden = false;
      input.focus();
    };
    const bar = h(
      'div',
      { class: 'bs-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
      tool('bold', 'Bold', 'bold'),
      tool('italic', 'Italic', 'italic'),
      h('button', {
        type: 'button', class: 'bs-tool', 'aria-label': 'Link', title: 'Link', onmousedown: (e) => e.preventDefault(), onclick: openLink, dataset: { key: `${key}:link` },
      }, icon('link')),
      h('span', { class: 'bs-tool-sep' }),
      lists ? tool('ul', 'Bulleted list', 'insertUnorderedList') : null,
      lists ? tool('ol', 'Numbered list', 'insertOrderedList') : null,
      lists ? h('span', { class: 'bs-tool-sep' }) : null,
      h('button', {
        type: 'button',
        class: 'bs-tool',
        'aria-label': 'Clear formatting',
        title: 'Clear formatting',
        onmousedown: (e) => e.preventDefault(),
        onclick: () => {
          exec('removeFormat');
          exec('unlink');
        },
      }, icon('clear')),
    );
    return [bar, linkBox];
  }

  function headingField(slot, key, gi) {
    const head = fieldHead(slot, key, gi);
    const level = h('select', {
      class: 'bs-input bs-level',
      'aria-label': 'Heading level',
      dataset: { key: `${key}:level` },
      disabled: locked(),
      onchange: (e) => setField(key, { level: Number(e.target.value) }, true),
    }, HEADING_LEVELS.map((n) => h('option', { value: n }, `H${n}`)));
    const editor = richEditor(slot, key, { single: true, labelId: `${head.id}-label` });
    const issues = issuesBox(slot.field.id);
    binds.push(() => {
      const current = slotOf(key);
      if (!current?.field) return;
      if (document.activeElement !== level) level.value = String(current.field.level);
      syncRich(editor, current.field.value);
      updateCount(head.count, fieldText(current.field, doc).length, limitFor(current, state.rules));
      issues.update();
    });
    return [head.el, h('div', { class: 'bs-heading-row' }, level, editor), head.hint, issues.box];
  }

  function textField(slot, key, gi) {
    const head = fieldHead(slot, key, gi);
    // Short fields such as an eyebrow stay one line; the value keeps its paragraph.
    const compact = (limitFor(slot, state.rules) || Infinity) <= 40
      && !/<(?:ul|ol|li|br)\b|<\/p>\s*<p/i.test(slot.field.value || '');
    const editor = richEditor(slot, key, { single: false, compact, labelId: `${head.id}-label` });
    const issues = issuesBox(slot.field.id);
    binds.push(() => {
      const current = slotOf(key);
      if (!current?.field) return;
      syncRich(editor, current.field.value);
      updateCount(head.count, fieldText(current.field, doc).length, limitFor(current, state.rules));
      issues.update();
    });
    const bar = locked() ? null : toolbar(editor, key, { lists: !compact });
    return [head.el, bar, editor, head.hint, issues.box];
  }

  function textInput(key, prop, attrs, commitOnInput = false) {
    const el = h('input', {
      class: 'bs-input', dataset: { key: `${key}:${prop}` }, disabled: locked(), ...attrs,
    });
    el.addEventListener('input', () => {
      sent.set(el, el.value);
      setField(key, { [prop]: el.value }, commitOnInput);
    });
    el.addEventListener('change', () => setField(key, { [prop]: el.value }, true));
    return el;
  }

  function buttonField(slot, key, gi) {
    const head = fieldHead(slot, key, gi);
    const text = textInput(key, 'text', { id: head.id, placeholder: 'Button text' });
    const href = textInput(key, 'href', {
      type: 'text', placeholder: 'https://… or /page', 'aria-label': `${slot.label} URL`, inputmode: 'url',
    });
    href.addEventListener('change', () => {
      const safe = safeUrl(href.value);
      if (href.value.trim() && !safe) {
        toast('That link type is not allowed.');
        href.value = '';
        setField(key, { href: '' }, true);
      }
    });
    const styles = [...BUTTON_STYLES];
    if (slot.field.style === 'accent') styles.splice(2, 0, ['accent', 'Accent']);
    const group = h('div', { class: 'bs-seg', role: 'radiogroup', 'aria-label': 'Button style' }, styles.map(([value, label]) => h('button', {
      type: 'button',
      role: 'radio',
      class: 'bs-seg-btn',
      dataset: { value, key: `${key}:style:${value}` },
      disabled: locked(),
      onclick: () => setField(key, { style: value }, true),
    }, label)));
    const issues = issuesBox(slot.field.id);
    binds.push(() => {
      const current = slotOf(key);
      if (!current?.field) return;
      const { field } = current;
      sync(text, field.text);
      sync(href, field.href);
      group.querySelectorAll('button').forEach((btn) => btn.setAttribute('aria-checked', String(btn.dataset.value === field.style)));
      updateCount(head.count, fieldText(field, doc).length, limitFor(current, state.rules));
      issues.update();
    });
    return [head.el, h('div', { class: 'bs-button-grid' }, text, href), group, head.hint, issues.box];
  }

  function imageField(slot, key, gi) {
    const head = fieldHead(slot, key, gi);
    const thumb = h('div', { class: 'bs-thumb' });
    const meta = h('p', { class: 'bs-img-meta' });
    const file = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
      hidden: true,
      onchange: () => {
        const current = slotOf(key);
        if (file.files[0] && current?.field) on.upload(current.field.id, file.files[0]);
        file.value = '';
      },
    });
    const replace = h('button', {
      type: 'button', class: 'bs-btn bs-small-btn', disabled: locked(), dataset: { key: `${key}:upload` }, onclick: () => file.click(),
    }, icon('upload'), 'Replace');
    const alt = textInput(key, 'alt', { id: head.id, placeholder: 'Describe the image for screen readers' });
    const altCount = h('span', { class: 'bs-counter' });
    const issues = issuesBox(slot.field.id);
    let shown = '';
    binds.push(() => {
      const current = slotOf(key);
      if (!current?.field) return;
      const { field } = current;
      const info = on.image(field.src) || {};
      const url = info.url || '';
      if (url !== shown) {
        shown = url;
        fill(thumb, url ? h('img', { src: url, alt: '' }) : icon('image', 'bs-i bs-thumb-empty'));
      }
      const parts = [];
      if (info.width) parts.push(`${info.width} × ${info.height}`);
      if (info.bytes) parts.push(formatBytes(info.bytes));
      if (info.uploading) parts.push('Uploading…');
      meta.textContent = parts.join(' · ') || (field.src ? 'Image' : 'No image yet');
      sync(alt, field.alt);
      updateCount(altCount, (field.alt || '').length, LIMITS.alt);
      issues.update();
    });
    return [
      h('div', { class: 'bs-field-head' }, h('span', { class: 'bs-label' }, slot.label), head.el.querySelector('.bs-remove')),
      h('div', { class: 'bs-image' }, thumb, h('div', { class: 'bs-image-side' }, meta, replace, file)),
      h('div', { class: 'bs-field-head bs-sub-head' }, h('label', { class: 'bs-label', for: head.id }, 'Alt text'), altCount, head.el.querySelector('.bs-ai-btn')),
      alt,
      issues.box,
    ];
  }

  function iconField(slot, key, gi) {
    const head = fieldHead(slot, key, gi);
    const preview = h('img', { class: 'bs-icon-img', alt: '' });
    const name = h('span', { class: 'bs-icon-name' });
    const picker = h('div', { class: 'bs-picker', hidden: true });
    const chip = h('button', {
      type: 'button',
      class: 'bs-icon-chip',
      id: head.id,
      'aria-expanded': 'false',
      disabled: locked(),
      dataset: { key: `${key}:icon` },
      onclick: () => {
        picker.hidden = !picker.hidden;
        chip.setAttribute('aria-expanded', String(!picker.hidden));
        // eslint-disable-next-line no-use-before-define
        if (!picker.hidden) fillPicker();
      },
    }, preview, name, h('span', { class: 'bs-muted bs-small' }, 'Change'));
    const choose = (value) => {
      picker.hidden = true;
      chip.setAttribute('aria-expanded', 'false');
      setField(key, { name: toClass(value) }, true);
      chip.focus();
    };
    function fillPicker() {
      const current = slotOf(key)?.field?.name;
      const names = [...new Set([...(state.icons || []), current].filter(Boolean))].sort();
      const custom = h('input', { class: 'bs-input', placeholder: 'Icon name', 'aria-label': 'Icon name' });
      custom.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && custom.value.trim()) choose(custom.value);
      });
      fill(
        picker,
        names.length ? h('div', { class: 'bs-icon-grid' }, names.map((n) => h('button', {
          type: 'button', class: `bs-icon-opt ${n === current ? 'bs-on' : ''}`, title: n, 'aria-label': n, onclick: () => choose(n),
        }, h('img', { src: on.iconUrl(n), alt: '' }), h('span', {}, n)))) : h('p', { class: 'bs-muted bs-small' }, 'No icons found on this site yet.'),
        h('div', { class: 'bs-inline' }, custom, h('button', { type: 'button', class: 'bs-btn bs-small-btn', onclick: () => custom.value.trim() && choose(custom.value) }, 'Use')),
      );
    }
    const issues = issuesBox(slot.field.id);
    binds.push(() => {
      const current = slotOf(key);
      if (!current?.field) return;
      const url = current.field.name ? on.iconUrl(current.field.name) : '';
      if (preview.getAttribute('src') !== url) {
        if (url) preview.setAttribute('src', url);
        else preview.removeAttribute('src');
      }
      name.textContent = current.field.name || 'Pick an icon';
      issues.update();
    });
    return [head.el, chip, picker, head.hint, issues.box];
  }

  function rawField(slot, key, gi) {
    const head = fieldHead(slot, key, gi, { removable: false });
    const text = fieldText(slot.field, doc) || slot.field.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return [head.el, h('p', { class: 'bs-raw' }, text ? `“${text.slice(0, 120)}${text.length > 120 ? '…' : ''}”` : 'Embedded content', h('span', { class: 'bs-muted bs-small' }, ' Edit this part in the page.'))];
  }

  const EDITORS = {
    heading: headingField,
    text: textField,
    button: buttonField,
    image: imageField,
    icon: iconField,
    raw: rawField,
  };

  function slotEditor(slot, key, gi, group) {
    if (!slot.field) {
      return h('button', {
        type: 'button',
        class: 'bs-add-slot',
        disabled: locked(),
        dataset: { target: `slot:${group.row.id}:${slot.c}:${slot.slot}`, key: `${key}:add` },
        onclick: () => on.addField({
          row: group.row.id,
          c: slot.c,
          at: slot.at,
          type: slot.type,
          sample: slot.sample,
          label: slot.label,
        }),
      }, icon('plus'), `Add ${slot.label.toLowerCase().replace(/ \d+$/, '')}`);
    }
    return h('div', {
      class: `bs-field bs-field-${slot.type}`, dataset: { target: slot.field.id },
    }, EDITORS[slot.type](slot, key, gi));
  }

  /* Items and groups */

  function groupBody(group, gi) {
    return group.cells.map((cell, c) => h(
      'div',
      { class: 'bs-cell' },
      group.cells.length > 1 && cell.length && group.kind === 'item' && c > 0 ? h('div', { class: 'bs-cell-sep' }) : null,
      cell.map((slot, k) => slotEditor(slot, `${gi}:${c}:${k}`, gi, group)),
      !cell.length ? h('p', { class: 'bs-muted bs-small' }, 'Empty cell') : null,
    ));
  }

  function itemIssueBadge(group) {
    const { id } = group.row;
    const issues = (state.issues || []).filter((issue) => issue.target === `row:${id}`
      || issue.target.startsWith(`${id}.`) || issue.target.startsWith(`slot:${id}:`));
    if (!issues.length) return null;
    const level = issues.some((i) => i.level === 'error') ? 'error' : 'warn';
    return h('span', { class: `bs-badge bs-badge-${level}`, title: plural(issues.length, 'issue') }, String(issues.length));
  }

  function itemCard(group, gi, total) {
    const open = state.open.has(group.n);
    const subtitle = h('span', { class: 'bs-item-sub' });
    const badge = h('span', { class: 'bs-item-badge' });
    const toggle = h('button', {
      type: 'button',
      class: 'bs-item-toggle',
      'aria-expanded': String(open),
      dataset: { key: `item:${group.n}` },
      onclick: () => {
        if (open) state.open.delete(group.n);
        else state.open.add(group.n);
        // eslint-disable-next-line no-use-before-define
        render(true);
      },
    }, icon('chevron', 'bs-i bs-chev'), h('span', { class: 'bs-item-title' }, group.title), subtitle, badge);
    const tools = locked() ? null : h(
      'div',
      { class: 'bs-item-tools' },
      tiny('up', `Move ${group.title} up`, () => on.moveItem(group.row.id, -1, group.n), group.n === 1),
      tiny('down', `Move ${group.title} down`, () => on.moveItem(group.row.id, 1, group.n), group.n === total),
      tiny('copy', `Duplicate ${group.title}`, () => on.addItem({ from: group.row.id, after: group.row.id, n: group.n })),
      tiny('trash', `Delete ${group.title}`, () => on.deleteItem(group.row.id, group.n), total < 2),
    );
    binds.push(() => {
      const current = groupOf(gi);
      if (!current) return;
      subtitle.textContent = current.subtitle || '';
      fill(badge, itemIssueBadge(current));
    });
    return h(
      'li',
      { class: `bs-item ${open ? 'bs-open' : ''}`, dataset: { target: `row:${group.row.id}` } },
      h('div', { class: 'bs-item-head' }, toggle, tools),
      open ? h('div', { class: 'bs-item-body' }, groupBody(group, gi)) : null,
    );
  }

  function itemsSection() {
    const { groups } = view();
    const { noun } = state.model;
    const items = groups.map((group, gi) => itemCard(group, gi, groups.length));
    return h(
      'section',
      { class: 'bs-section' },
      h('div', { class: 'bs-section-head' }, h('h2', {}, `${noun}s`), h('span', { class: 'bs-count' }, String(groups.length)), h('span', { class: 'bs-grow' }), groups.length > 1 ? h('button', {
        type: 'button',
        class: 'bs-link-btn',
        onclick: () => {
          const all = groups.every((g) => state.open.has(g.n));
          groups.forEach((g) => (all ? state.open.delete(g.n) : state.open.add(g.n)));
          // eslint-disable-next-line no-use-before-define
          render(true);
        },
      }, groups.every((g) => state.open.has(g.n)) ? 'Collapse all' : 'Expand all') : null),
      h('ul', { class: 'bs-items' }, items),
      locked() ? null : h('button', {
        type: 'button',
        class: 'bs-add-item',
        dataset: { key: 'add-item' },
        onclick: () => {
          const last = groups[groups.length - 1];
          on.addItem({ from: last.row.id, blank: true, n: groups.length });
        },
      }, icon('plus'), `Add ${noun.toLowerCase()}`),
    );
  }

  function groupsSection() {
    return view().groups.map((group, gi) => h(
      'section',
      { class: 'bs-section bs-group', dataset: { target: `row:${group.row.id}` } },
      view().groups.length > 1 || group.title !== 'Content' ? h('div', { class: 'bs-section-head' }, h('h2', {}, group.title)) : null,
      h('div', { class: 'bs-card' }, groupBody(group, gi)),
    ));
  }

  /* Variants and options */

  /**
   * The variants authors can choose: the block library's examples, then the rules sheet's
   * `variants` row, keyed by their sorted classes so order doesn't matter.
   */
  function configuredVariants() {
    const list = new Map();
    const add = (v) => {
      const classes = [...new Set(String(v.value || '').split(/\s+/).map(toClass).filter(Boolean))];
      const id = [...classes].sort().join(' ');
      if (classes.length && !list.has(id)) list.set(id, { ...v, classes });
    };
    (state.libraryVariants || []).forEach(add);
    (state.rules?.variants || []).forEach((v) => add({ value: v, title: title(v), description: '' }));
    return list;
  }

  /**
   * A dropdown of the documented variants: authors can't type their own. A variant on the
   * page that isn't documented is shown (so it can be changed) with a warning.
   */
  function variantsSection() {
    const { variants } = state.model;
    const configured = configuredVariants();
    if (!configured.size && !variants.length) return null;
    const now = configured.get([...variants].sort().join(' '));
    const label = (classes) => classes.map(title).join(', ');
    const select = h(
      'select',
      {
        class: 'bs-input',
        id: 'bs-variant',
        disabled: locked(),
        dataset: { key: 'variant' },
        onchange: (e) => on.setVariants(e.target.value ? e.target.value.split(' ') : []),
      },
      h('option', { value: '' }, 'Default'),
      variants.length && !now ? h('option', { value: variants.join(' ') }, `${label(variants)} (undocumented)`) : null,
      [...configured.values()].map((v) => h('option', { value: v.classes.join(' ') }, label(v.classes))),
    );
    select.value = now ? now.classes.join(' ') : variants.join(' ');
    let note = null;
    if (variants.length && !now) {
      note = h('p', { class: 'bs-variant-desc bs-variant-warn' }, icon('alert'), configured.size
        ? 'This variant isn\'t in the block library, so the site may not style it. Choose one from the list.'
        : 'This block has no documented variants, so the site may not style it. Choose Default to remove it.');
    } else if (now?.description) note = h('p', { class: 'bs-variant-desc' }, now.description);
    return h(
      'div',
      { class: 'bs-option bs-option-select bs-variants', dataset: { target: 'variant' } },
      h('label', { class: 'bs-label', for: 'bs-variant' }, 'Variant'),
      select,
      note,
    );
  }

  const optionDefs = () => state.rules?.optionDefs || new Map();
  const optionLabel = (key, keyText) => optionDefs().get(key)?.label
    || state.rules?.fields?.get(key)?.label || title(keyText || key);
  const valuesFor = (key) => state.rules?.values?.get(key) || [];
  const optionNow = (key) => view().options.find((o) => o.key === key);
  const isOff = (value) => /^(|false|no|off|0)$/i.test(String(value ?? '').trim());

  function optionControl(option) {
    const values = valuesFor(option.key);
    const key = `option:${option.key}`;
    if (values.length) {
      const known = values.some((v) => v.value === option.value || v.title === option.value);
      const select = h('select', {
        class: 'bs-input',
        id: `bs-${key.replace(':', '-')}`,
        dataset: { key },
        disabled: locked(),
        onchange: (e) => on.setOption(option.key, e.target.value, option.keyText),
      }, known ? null : h('option', { value: option.value }, option.value ? `${option.value} (not in the list)` : 'Choose…'), values.map((v) => h('option', { value: v.value }, v.title)));
      const match = values.find((v) => v.value === option.value || v.title === option.value);
      select.value = match?.value ?? option.value;
      return select;
    }
    const el = h('input', {
      class: 'bs-input', id: `bs-${key.replace(':', '-')}`, value: option.value, dataset: { key }, disabled: locked(),
    });
    el.addEventListener('input', () => on.setOption(option.key, el.value, option.keyText, false));
    el.addEventListener('change', () => on.setOption(option.key, el.value, option.keyText));
    return el;
  }

  /**
   * A control for an option the library defines. The block's default needs no row, so
   * choosing it removes the option row; any other choice writes `key | value`.
   */
  function definedControl(def) {
    const key = `option:${def.key}`;
    const id = `bs-option-${def.key}`;
    const option = optionNow(def.key);
    const current = option?.value ?? '';
    const apply = (value, commit = true) => {
      const v = String(value ?? '').trim();
      if (!v || v === def.default) {
        if (optionNow(def.key)) on.removeOption(def.key);
      } else on.setOption(def.key, v, def.keyText, commit);
    };
    if (def.type === 'select') {
      const values = def.values.length ? def.values : valuesFor(def.key);
      const fallback = values.find((v) => v.value === def.default);
      const match = values.find((v) => v.value === current || v.title === current);
      const select = h(
        'select',
        {
          class: 'bs-input', id, dataset: { key }, disabled: locked(), onchange: (e) => apply(e.target.value),
        },
        h('option', { value: '' }, fallback ? `${fallback.title} (default)` : 'Default'),
        current && !match ? h('option', { value: current }, `${current} (not in the list)`) : null,
        values.filter((v) => v !== fallback).map((v) => h('option', { value: v.value }, v.title)),
      );
      if (!match) select.value = current;
      else select.value = match === fallback ? '' : match.value;
      return select;
    }
    if (def.type === 'toggle') {
      const checked = !!option && !isOff(current);
      return h(
        'label',
        { class: 'bs-toggle' },
        h('input', {
          type: 'checkbox',
          id,
          checked,
          disabled: locked(),
          dataset: { key },
          onchange: (e) => (e.target.checked
            ? on.setOption(def.key, def.values[0]?.value || 'true', def.keyText)
            : apply('')),
        }),
        h('span', { class: 'bs-toggle-track', 'aria-hidden': 'true' }),
        h('span', { class: 'bs-small' }, checked ? 'On' : 'Off'),
      );
    }
    if (def.type === 'image') {
      const busy = !!on.optionBusy?.(def.key);
      const info = current ? on.image(current) || {} : {};
      const file = h('input', {
        type: 'file',
        accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
        hidden: true,
        onchange: () => {
          if (file.files[0]) on.uploadOption(def.key, file.files[0], def.keyText);
          file.value = '';
        },
      });
      return h(
        'div',
        { class: 'bs-image bs-option-image' },
        h('div', { class: 'bs-thumb' }, info.url ? h('img', { src: info.url, alt: '' }) : icon('image', 'bs-i bs-thumb-empty')),
        h(
          'div',
          { class: 'bs-image-side' },
          h('p', { class: 'bs-img-meta' }, (busy && 'Uploading…') || (current ? 'Image set' : 'No image')),
          h(
            'div',
            { class: 'bs-inline' },
            h('button', {
              type: 'button', id, class: 'bs-btn bs-small-btn', disabled: locked() || busy, dataset: { key: `${key}:upload` }, onclick: () => file.click(),
            }, icon('upload'), current ? 'Replace' : 'Choose image'),
            current && !locked() ? h('button', {
              type: 'button', class: 'bs-btn bs-small-btn', dataset: { key: `${key}:remove` }, onclick: () => on.removeOption(def.key),
            }, 'Remove') : null,
          ),
          file,
        ),
      );
    }
    const el = h('input', {
      class: 'bs-input', id, value: current, placeholder: def.default || '', dataset: { key }, disabled: locked(),
    });
    // Each keystroke reaches the model (adding the row if needed), so a re-render keeps it.
    el.addEventListener('input', () => {
      if (!el.value.trim()) return;
      on.setOption(def.key, el.value, def.keyText, false);
      sent.set(el, optionNow(def.key)?.value ?? '');
    });
    el.addEventListener('change', () => apply(el.value));
    binds.push(() => sync(el, optionNow(def.key)?.value ?? ''));
    return el;
  }

  /** Known settings the block doesn't have yet; with library definitions, the only ones to add. */
  function addableKeys() {
    const present = new Set(view().options.map((o) => o.key));
    const defs = optionDefs();
    return [...(state.rules?.values?.keys() || []), ...(state.rules?.options || [])]
      .filter((key, i, all) => !present.has(key) && !defs.has(key) && all.indexOf(key) === i);
  }

  function addOptionForm() {
    const known = addableKeys();
    const free = !optionDefs().size;
    if (!state.addingOption) {
      return locked() ? null : h('button', {
        type: 'button',
        class: 'bs-link-btn bs-add-option',
        dataset: { target: 'add-option', key: 'add-option' },
        onclick: () => {
          state.addingOption = known[0] || '-';
          // eslint-disable-next-line no-use-before-define
          render(true);
        },
      }, icon('plus'), known.length ? `Add option (${known.map((k) => optionLabel(k)).join(', ')})` : 'Add option');
    }
    const keyInput = h('input', {
      class: 'bs-input',
      placeholder: 'Setting, e.g. theme',
      'aria-label': 'Option name',
      list: 'bs-option-keys',
      dataset: { key: 'new-option-key' },
      value: state.addingOption === '-' ? '' : state.addingOption,
    });
    const keyList = h('datalist', { id: 'bs-option-keys' }, known.map((k) => h('option', { value: k }, optionLabel(k))));
    const valueBox = h('div', { class: 'bs-grow' });
    let valueInput;
    const fillValue = () => {
      const values = valuesFor(toClass(keyInput.value));
      valueInput = values.length
        ? h('select', { class: 'bs-input', 'aria-label': 'Option value' }, values.map((v) => h('option', { value: v.value }, v.title)))
        : h('input', { class: 'bs-input', placeholder: 'Value', 'aria-label': 'Option value' });
      fill(valueBox, valueInput);
    };
    keyInput.addEventListener('input', fillValue);
    fillValue();
    const done = () => {
      state.addingOption = '';
      // eslint-disable-next-line no-use-before-define
      render(true);
    };
    return h(
      'div',
      { class: 'bs-add-option-form', dataset: { target: 'add-option' } },
      h('div', { class: 'bs-option-grid' }, keyInput, keyList, valueBox),
      h('div', { class: 'bs-inline bs-end' }, h('button', { type: 'button', class: 'bs-btn bs-small-btn', onclick: done }, 'Cancel'), h('button', {
        type: 'button',
        class: 'bs-btn bs-primary bs-small-btn',
        onclick: () => {
          const key = toClass(keyInput.value);
          if (!key) {
            toast('Give the option a name, such as theme.');
            return;
          }
          if (!free && !known.includes(key)) {
            toast(`This block's options are set by the library. Add one of: ${known.map((k) => optionLabel(k)).join(', ')}.`);
            return;
          }
          on.setOption(key, valueInput.value, keyInput.value.trim().toLowerCase());
          done();
        },
      }, 'Add')),
    );
  }

  const optionIssues = (key) => h('ul', { class: 'bs-field-issues bs-option-issues' }, issuesFor(`option:${key}`).map((issue) => h('li', { class: `bs-${issue.level}` }, issueIcon(issue.level), issue.message)));

  /**
   * Options the library defines are always listed, in sheet order, with a control for
   * their type. Other settings rows on the block are listed after them; free-form
   * options can be added only when the block has no definitions.
   */
  function optionsSection() {
    const defs = optionDefs();
    const defined = [...defs.values()].map((def) => h(
      'div',
      { class: `bs-option bs-option-${def.type}`, dataset: { target: `option:${def.key}` } },
      h('label', { class: 'bs-label', for: `bs-option-${def.key}` }, def.label || title(def.keyText)),
      definedControl(def),
      optionIssues(def.key),
    ));
    const rows = view().options.filter((option) => !defs.has(option.key)).map((option) => h(
      'div',
      { class: 'bs-option', dataset: { target: `option:${option.key}` } },
      h('label', { class: 'bs-label', for: `bs-option-${option.key}` }, optionLabel(option.key, option.keyText)),
      optionControl(option),
      locked() ? null : iconBtn('close', `Remove ${optionLabel(option.key, option.keyText)}`, () => on.removeOption(option.key)),
      optionIssues(option.key),
    ));
    return h(
      'section',
      { class: 'bs-section' },
      h('div', { class: 'bs-section-head' }, h('h2', {}, 'Block options'), h('span', { class: 'bs-grow' }), h('span', { class: 'bs-muted bs-small' }, 'Once per block')),
      h('div', { class: 'bs-card bs-options' }, variantsSection(), defined, rows, !defs.size || addableKeys().length ? addOptionForm() : null),
    );
  }

  function briefSection() {
    if (!state.ai?.available || locked()) return null;
    const input = h('input', {
      class: 'bs-input', placeholder: 'e.g. Spring savings offers for young families', 'aria-label': 'Brief', dataset: { key: 'brief' },
    });
    const go = () => {
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      on.ai({ kind: 'brief', brief: input.value.trim() });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h(
      'details',
      { class: 'bs-brief', open: state.briefOpen ? true : undefined, ontoggle: (e) => { state.briefOpen = e.target.open; } },
      h('summary', { class: 'bs-brief-sum' }, icon('spark'), 'Fill from a brief'),
      h('p', { class: 'bs-muted bs-small' }, 'One line in, every field written by the assistant. You can undo it in one click.'),
      h('div', { class: 'bs-inline' }, input, h('button', {
        type: 'button', class: 'bs-btn bs-primary bs-small-btn', onclick: go, disabled: state.ai.busy,
      }, 'Write')),
    );
  }

  /* Whole views */

  function blockView() {
    const { model, target } = state;
    const health = h('div', { class: 'bs-health-box' });
    const banner = h('div', { class: 'bs-ai-banner' });
    const count = model.mode === 'items' ? plural(view().groups.length, model.noun.toLowerCase()) : '';
    binds.push(() => {
      renderHealth(health);
      renderAiBanner(banner);
    });
    return [
      h(
        'div',
        { class: 'bs-block-head' },
        h('div', {}, h('h2', {}, title(model.name)), h('p', { class: 'bs-muted bs-small' }, [`Block ${target.index + 1} on the page`, count].filter(Boolean).join(' · '))),
        locked() ? h('span', { class: 'bs-tag' }, 'Read only') : null,
      ),
      health,
      banner,
      briefSection(),
      optionsSection(),
      model.mode === 'items' ? itemsSection() : groupsSection(),
    ];
  }

  function emptyView() {
    const blocks = state.blocks || [];
    const demo = state.mode === 'demo';
    return h(
      'div',
      { class: 'bs-empty' },
      h('div', { class: 'bs-empty-art' }, icon('cursor')),
      h('h2', {}, 'Click inside a block in the page'),
      h('p', { class: 'bs-muted' }, 'Block Studio turns it into a simple form. Your changes are saved to the page as you type.'),
      blocks.length ? h('div', { class: 'bs-outline' }, h('p', { class: 'bs-label' }, `Blocks on this page (${blocks.length})`), h('ol', {}, blocks.map((b) => h('li', {}, h(demo ? 'button' : 'div', {
        type: demo ? 'button' : undefined,
        class: 'bs-outline-row',
        onclick: demo ? () => on.selectBlock(b.index) : undefined,
      }, h('span', { class: 'bs-num' }, String(b.index + 1)), h('span', { class: 'bs-outline-text' }, h('strong', {}, title(b.name)), b.variants.length ? ` (${b.variants.join(', ')})` : '', h('span', { class: 'bs-muted' }, b.text ? ` · ${b.text}` : ''))))))) : h('p', { class: 'bs-muted bs-small' }, 'This page has no blocks yet.'),
    );
  }

  function messageView(heading, text, actions = []) {
    return h('div', { class: 'bs-empty' }, h('div', { class: 'bs-empty-art' }, icon('mark')), h('h2', {}, heading), h('p', { class: 'bs-muted' }, text), actions);
  }

  function shapeOf() {
    if (state.phase !== 'block' || !state.model) return `${state.phase}:${(state.blocks || []).map((b) => b.name + b.text).join('|')}`;
    return JSON.stringify([
      state.target.index, state.model.name, state.model.mode, state.model.noun,
      state.model.variants, state.editable,
      state.ai?.available, state.ai?.busy, state.addingOption, [...state.open].sort(),
      state.rules?.variants, state.libraryVariants,
      [...optionDefs().values()].map((d) => [d.key, d.type, d.type === 'text' ? '' : optionNow(d.key)?.value ?? null, d.type === 'image' && !!on.optionBusy?.(d.key), (state.issues || []).filter((i) => i.target === `option:${d.key}`).length]),
      view().options.map((o) => [o.key, valuesFor(o.key).length ? o.value : '', (state.issues || []).filter((i) => i.target === `option:${o.key}`).length]),
      view().groups.map((g) => [g.kind, g.title, g.cells.map((cell) => cell.map((s) => [s.type, !!s.field, s.label, s.field?.style === 'accent']))]),
    ]);
  }

  function patch() {
    renderHead();
    renderStatus();
    binds.forEach((fn) => fn());
  }

  function render(force = false) {
    const next = shapeOf();
    if (!force && next === shape && ui.body.childElementCount) {
      patch();
      return;
    }
    shape = next;
    const focus = captureFocus();
    // A different block starts at the top; the same block keeps its place.
    const which = state.phase === 'block' && state.model ? `${state.target?.index}:${state.model.name}` : state.phase;
    const scroll = which === openedBlock ? document.scrollingElement?.scrollTop || 0 : 0;
    openedBlock = which;
    closeMenu();
    binds = [];
    let content;
    switch (state.phase) {
      case 'loading':
        content = h('div', { class: 'bs-busy' }, h('span', { class: 'bs-spinner' }), 'Connecting to the page…');
        break;
      case 'unsupported':
        content = messageView('Open this page in Experience Workspace', 'Block Studio reads the page you are editing, and this editor does not share it with extensions. Open the page in Experience Workspace and pick Block Studio from the Library.', [
          h('button', { type: 'button', class: 'bs-btn bs-primary', onclick: () => on.tryDemo() }, 'Try the demo'),
          h('a', {
            class: 'bs-link', href: DOCS_URL, target: '_blank', rel: 'noopener',
          }, 'How to install', icon('out')),
        ]);
        break;
      case 'error':
        content = messageView('Something went wrong', state.error || 'Block Studio could not start.', [h('button', { type: 'button', class: 'bs-btn', onclick: () => window.location.reload() }, 'Reload')]);
        break;
      case 'block':
        content = blockView();
        break;
      default:
        content = emptyView();
    }
    fill(ui.body, content, h('footer', { class: 'bs-foot' }, h('span', {}, state.rulesFound ? 'Using this site\'s block-studio rules' : 'Zero-config mode'), h('a', {
      class: 'bs-link', href: DOCS_URL, target: '_blank', rel: 'noopener',
    }, 'Help')));
    patch();
    restoreFocus(ui.body, focus);
    if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (menu && !menu.contains(e.target) && !e.target.closest('.bs-ai-btn')) closeMenu();
  });

  return {
    render, patch, toast, reveal, renderStatus,
  };
}
