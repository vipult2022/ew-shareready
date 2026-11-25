/**
 * Naming a block's fields. When the block library doesn't name a block's fields, Block
 * Studio suggests names from the block's content, the site's rules and the block's code.
 * A person reviews them, and they are saved to the block's library page as the
 * `library-metadata` `fields` table (Block Inspector's format), which rules.js reads
 * back for every author. Nothing here changes the page being edited.
 */

import { escapeHtml } from './dom.js';
import {
  parseBlock, layout, labelFields, fieldText, nounFor, toClass,
} from './model.js';
import { DA_ADMIN, fieldRule, fieldRuleRows } from './rules.js';
import { limitFor } from './check.js';
import {
  parseHtml, blockElements, classesOf, cleanBlock, previewUrl,
} from './live.js';

/* Suggestions */

const NOT_NOUNS = new Set(['wrapper', 'container', 'content', 'contents', 'body', 'inner',
  'image', 'images', 'img', 'picture', 'media', 'text', 'title', 'label', 'heading',
  'description', 'icon', 'icons', 'button', 'buttons', 'link', 'links', 'nav', 'navigation',
  'control', 'controls', 'list', 'item', 'items', 'active', 'open', 'hidden', 'visible', 'bg',
  'background', 'header', 'footer', 'indicator', 'indicators', 'prev', 'next', 'dot', 'dots',
  'arrow', 'arrows', 'track', 'viewport', 'grid', 'row', 'col', 'column', 'columns', 'cell',
  'block', 'section', 'loaded', 'selected', 'current', 'expanded', 'collapsed']);

/**
 * What the block's code calls one of its items: the most common word after the block
 * name in its class names (`cards-card-image`, `carousel-slide` → "Card", "Slide").
 */
export function codeNoun(js, name) {
  const key = toClass(name);
  if (!js || !key) return '';
  const counts = new Map();
  [...String(js).matchAll(new RegExp(`(?:^|[^a-z0-9-])${key}-([a-z][a-z0-9]*)`, 'g'))]
    .forEach(([, word]) => counts.set(word, (counts.get(word) || 0) + 1));
  const merged = new Map();
  counts.forEach((count, word) => {
    const one = word.endsWith('s') && counts.has(word.slice(0, -1)) ? word.slice(0, -1) : word;
    merged.set(one, (merged.get(one) || 0) + count);
  });
  let best = '';
  merged.forEach((count, word) => {
    if (word.length > 2 && !NOT_NOUNS.has(word) && count > (merged.get(best) || 0)) best = word;
  });
  return best ? best[0].toUpperCase() + best.slice(1) : '';
}

const NOUN_WORDS = {
  heading: 'title',
  subheading: 'subtitle',
  title: 'title',
  description: 'description',
  eyebrow: 'eyebrow',
  image: 'image',
  icon: 'icon',
  text: 'text',
  list: 'list',
};

/** "Heading" → "Card title", "Image 2" → "Card image 2"; other names stay as they are. */
function itemLabel(noun, label) {
  const match = /^([a-z]+)(?: (\d+))?$/i.exec(label || '');
  const word = match && NOUN_WORDS[match[1].toLowerCase()];
  if (!noun || !word) return label;
  return `${noun} ${word}${match[2] ? ` ${match[2]}` : ''}`;
}

const clip = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Names for each field of an example block. A block of items is named by its first
 * item, which names every item; other blocks are named row by row, and their settings
 * rows are left out. Each field says where its current name comes from (`source`:
 * 'library', 'sheet', 'rule' or 'auto'). Once the library or the `fields` sheet names
 * the block (`named`), the labels are those names as they are, and other fields are
 * left empty so they keep their automatic name. Otherwise they are suggestions: a rule
 * from the site's `block-studio` sheet keeps its label, and other names in an item
 * start with the item's noun (from the rules, the code, or the block name). Names from
 * the `fields` sheet are `locked`: only the sheet changes them. Each field also has the
 * limits the example's `field-rules` table (`opts.fieldRules`) sets for it (`max`,
 * `required`, `hint`) and the limit it has without them (`maxDefault`, from `baseRules`).
 * @returns {{multi: boolean, noun: string, named: boolean, rows: object[]}} rows are
 *   {option: true, size} or
 *   {n, title, cells: [[{type, label, shown, auto, source, locked, units, text,
 *   max, required, hint, maxDefault}]]}
 */
export function suggestNames(blockEl, hints = {}, opts = {}) {
  const {
    rules = null, baseRules = rules, fieldRules = [], codeNoun: fromCode = '',
  } = opts;
  const model = parseBlock(blockEl, hints);
  const doc = blockEl.ownerDocument;
  const view = layout(model, doc);
  const multi = model.mode === 'items';
  const noun = hints.noun || fromCode || nounFor(model.name);
  const nameCell = (cell, slots) => {
    const fallback = labelFields(cell.fields, doc);
    return cell.fields.map((field, f) => {
      const slot = slots.find((s) => s.field === field);
      const label = slot?.label || fallback[f];
      const plain = slot?.auto || label;
      const shown = fieldRule(rules, label, field.type, plain).label || label;
      return {
        type: field.type,
        shown,
        plain,
        auto: fieldRule(rules, plain, field.type).label || plain,
        source: slot?.source || (shown !== plain ? 'rule' : 'auto'),
        units: field.units ?? 1,
        text: clip(fieldText(field, doc)),
        maxDefault: limitFor({ label: shown, type: field.type, auto: plain }, baseRules),
      };
    });
  };
  let rows;
  if (multi) {
    const first = view.groups[0];
    rows = first ? [{
      n: 1,
      title: `Every ${noun.toLowerCase()}`,
      cells: first.row.cells.map((cell, c) => nameCell(cell, first.cells[c] || [])),
    }] : [];
  } else {
    const content = model.rows.filter((row) => row.kind === 'item');
    rows = model.rows.map((row) => {
      if (row.kind === 'option') return { option: true, size: 2 };
      const slots = view.groups.filter((group) => group.row === row)
        .flatMap((group) => group.cells.flat());
      const n = content.indexOf(row) + 1;
      return {
        n,
        title: content.length > 1 ? `Row ${n}` : 'Content',
        cells: row.cells.map((cell, c) => nameCell(cell, slots.filter((slot) => slot.c === c))),
      };
    });
  }
  const fields = rows.flatMap((row) => (row.cells || []).flat());
  const named = fields.some((field) => ['library', 'sheet'].includes(field.source));
  fields.forEach((field) => {
    field.locked = field.source === 'sheet';
    if (named) field.label = ['library', 'sheet'].includes(field.source) ? field.shown : '';
    else if (field.source === 'rule') field.label = field.shown;
    else field.label = multi ? itemLabel(noun, field.shown) : field.shown;
    const keys = [field.label, field.shown, field.plain].map(toClass).filter(Boolean);
    const own = fieldRules.find((rule) => keys.includes(rule.field)) || {};
    Object.assign(field, {
      max: own.max || '', required: !!own.required, hint: own.hint || '',
    });
    delete field.plain;
  });
  return {
    multi, noun, named, rows,
  };
}

const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const maxOf = (value) => Math.max(0, Number.parseInt(value, 10) || 0);

/** The names and limits as they stand, to tell whether an author changed any. */
export const namesKey = (rows) => JSON.stringify(rows.map((row) => (row.cells || [])
  .map((fields) => fields.map((field) => [
    tidy(field.label), maxOf(field.max), !!field.required, tidy(field.hint),
  ]))));

/**
 * Each field's limits, by the name it is saved under (its name, else its automatic
 * name), for fields that set any. → [{field, max, required, hint}]
 */
export function fieldLimits(rows) {
  const seen = new Map();
  rows.flatMap((row) => (row.cells || []).flat()).forEach((field) => {
    const name = tidy(field.label) || tidy(field.auto);
    const limit = { max: maxOf(field.max), required: !!field.required, hint: tidy(field.hint) };
    if (!name || seen.has(toClass(name)) || (!limit.max && !limit.required && !limit.hint)) return;
    seen.set(toClass(name), { field: name, ...limit });
  });
  return [...seen.values()];
}

/**
 * The `field-rules` table: a "Field rules" header, a `Field | Max | Required | Hint`
 * row, then a row per field with limits. '' when no field has any.
 */
export function fieldRulesTable(rows) {
  const limits = fieldLimits(rows);
  if (!limits.length) return '';
  const tr = (cells) => `<tr>${cells.map((text) => `<td><p>${escapeHtml(String(text))}</p></td>`).join('')}</tr>`;
  const body = limits.map((limit) => tr([
    limit.field, limit.max || '', limit.required ? 'yes' : '', limit.hint,
  ]));
  return `<table><tbody><tr><td colspan="4"><p>Field rules</p></td></tr>${
    tr(['Field', 'Max', 'Required', 'Hint'])}${body.join('')}</tbody></table>`;
}

/* The library page */

/**
 * The `fields` table: a "Fields" header, then label rows that mirror the example's rows
 * and cells, with one paragraph per element a field covers. An empty name is IGNORE,
 * which keeps the automatic name, and so are settings rows.
 */
export function fieldsTable(rows) {
  const p = (text) => `<p>${escapeHtml(text)}</p>`;
  const td = (labels) => `<td>${labels.map(p).join('')}</td>`;
  const width = Math.max(1, ...rows.map((row) => (row.option ? row.size : row.cells.length)));
  const body = rows.map((row) => {
    if (row.option) return `<tr>${td(['IGNORE']).repeat(row.size)}</tr>`;
    return `<tr>${row.cells.map((fields) => td(fields.flatMap((field) => {
      const label = String(field.label ?? '').replace(/\s+/g, ' ').trim() || 'IGNORE';
      return Array(field.units || 1).fill(label);
    }))).join('')}</tr>`;
  });
  return `<table><tbody><tr><td colspan="${width}">${p('Fields')}</td></tr>${body.join('')}</tbody></table>`;
}

const sortedId = (classes) => [...new Set(classes.map(toClass))].sort().join(' ');

/** The library example to name: the one with these variants, else the default, else the first. */
export function pickExample(doc, name, variants = []) {
  const key = toClass(name);
  const all = blockElements(doc).filter((el) => classesOf(el)[0] === key);
  const id = sortedId(variants);
  return all.find((el) => sortedId(classesOf(el).slice(1)) === id)
    || all.find((el) => classesOf(el).length === 1) || all[0] || null;
}

/**
 * A library example made from a block on a page: no EW bookkeeping, no variant classes
 * (so it is the block's default example, not a new variant), and absolute image URLs.
 */
export function exampleFromBlock(el, pageUrl) {
  const copy = cleanBlock(el);
  copy.setAttribute('class', classesOf(el)[0] || '');
  copy.querySelectorAll('picture source').forEach((source) => source.remove());
  copy.querySelectorAll('img[src]').forEach((img) => {
    img.setAttribute('src', previewUrl(img.getAttribute('src'), pageUrl));
  });
  return copy.outerHTML;
}

const metaRow = (key, valueHtml) => `<div><div><p>${key}</p></div><div>${valueHtml}</div></div>`;

const nextDiv = (el) => {
  let next = el.nextElementSibling;
  while (next && next.tagName !== 'DIV') next = next.nextElementSibling;
  return next;
};

/**
 * The library page with the `fields` table in the example's `library-metadata`, and its
 * `field-rules` table (`rulesTable`) when one is given: added, replaced, or removed when
 * it is '' and the page has one. Adds the metadata, the example (a new section with a
 * heading) or the whole page as needed. Other metadata rows are kept.
 * @returns {{html: string, action: 'create-page'|'add-example'|'add-fields'|'replace-fields',
 *   rulesAction: ''|'add-rules'|'replace-rules'|'remove-rules'}}
 */
export function withFieldsTable(pageHtml, opts, Parser = DOMParser) {
  const {
    name, title, variants = [], table, exampleHtml, rulesTable = '',
  } = opts;
  const rulesRow = rulesTable ? metaRow('field-rules', rulesTable) : '';
  const meta = `<div class="library-metadata">${metaRow('fields', table)}${rulesRow}</div>`;
  const rulesAction = rulesTable ? 'add-rules' : '';
  const section = `<div><h2>${escapeHtml(title)}</h2>${exampleHtml}${meta}</div>`;
  if (!String(pageHtml || '').trim()) {
    return {
      html: `<body><header></header><main>${section}</main><footer></footer></body>`,
      action: 'create-page',
      rulesAction,
      hadRules: false,
    };
  }
  const doc = parseHtml(pageHtml, Parser);
  const main = doc.querySelector('main');
  if (!main) throw new Error('The library page is not a Document Authoring page, so it was left as it is');
  const example = pickExample(doc, name, variants);
  let action;
  let old = null;
  let rulesDone = rulesAction;
  if (!example) {
    main.insertAdjacentHTML('beforeend', section);
    action = 'add-example';
  } else {
    const next = nextDiv(example);
    const metaEl = classesOf(next)[0] === 'library-metadata' ? next : null;
    const rowOf = (key) => metaEl && [...metaEl.children]
      .find((r) => r.children[0]?.textContent.trim().toLowerCase() === key);
    const row = rowOf('fields');
    if (row?.children[1]) {
      row.children[1].innerHTML = table;
      action = 'replace-fields';
    } else if (metaEl) {
      metaEl.insertAdjacentHTML('beforeend', metaRow('fields', table));
      action = 'add-fields';
    } else {
      example.insertAdjacentHTML('afterend', meta);
      action = 'add-fields';
    }
    old = rowOf('field-rules');
    if (old) {
      const same = (html) => JSON.stringify(fieldRuleRows(parseHtml(`<div>${html}</div>`, Parser).body));
      if (!rulesTable) {
        old.remove();
        rulesDone = 'remove-rules';
      } else {
        rulesDone = same(old.children[1]?.innerHTML || '') === same(rulesTable) ? '' : 'replace-rules';
        if (old.children[1]) old.children[1].innerHTML = rulesTable;
        else old.insertAdjacentHTML('beforeend', `<div>${rulesTable}</div>`);
      }
    } else if (rulesTable && metaEl) {
      metaEl.insertAdjacentHTML('beforeend', rulesRow);
    }
  }
  const body = doc.querySelector('body');
  const html = body?.contains(main) ? body.outerHTML
    : `<body><header></header>${main.outerHTML}<footer></footer></body>`;
  return {
    html, action, rulesAction: rulesDone, hadRules: !!example && !!old,
  };
}

/* The library index (blocks.json) */

const SPECIAL_SHEETS = ['options', 'editor', 'fields'];
const sheetOf = (data) => ({
  total: data.length, limit: data.length, offset: 0, data,
});
const keyIn = (rows, wanted) => Object.keys(rows[0] || {})
  .find((key) => key.toLowerCase().trim() === wanted) || wanted;
const rowLike = (rows, values) => ({
  ...Object.fromEntries(Object.keys(rows[0] || {}).map((key) => [key, ''])),
  ...Object.fromEntries(Object.entries(values).map(([key, value]) => [keyIn(rows, key), value])),
});
const sameBlock = (a, b) => toClass(a) === toClass(b)
  || toClass(a).replace(/s$/, '') === toClass(b).replace(/s$/, '');

/**
 * The library index with a row for the block (if it isn't listed) and, for a block of
 * items, an `editor` row marking it `multi`. A single sheet becomes a multi-sheet only
 * when it needs the `editor` sheet.
 * @returns {{json: object, addedBlock: boolean, addedMulti: boolean}}
 */
export function withLibraryRows(json, {
  name, title, path, multi,
}) {
  const isMulti = Array.isArray(json?.[':names']);
  const names = isMulti ? [...json[':names']] : ['data'];
  const sheets = {};
  if (isMulti) names.forEach((n) => { sheets[n] = json[n] || sheetOf([]); });
  else sheets.data = Array.isArray(json?.data) ? json : sheetOf([]);
  let blocks = names.find((n) => !SPECIAL_SHEETS.includes(n));
  if (!blocks) {
    blocks = 'data';
    names.unshift(blocks);
    sheets.data = sheetOf([]);
  }
  const blockRows = [...(sheets[blocks].data || [])];
  const nameKey = keyIn(blockRows, 'name');
  const addedBlock = !blockRows.some((row) => sameBlock(row[nameKey], name));
  if (addedBlock) blockRows.push(rowLike(blockRows, { name: title, path }));
  const editorRows = [...(sheets.editor?.data || [])];
  const isMultiRow = (row) => sameBlock(String(row[keyIn(editorRows, 'block')] || '').replace(/\(.*\)/, ''), name)
    && /^multi$/i.test(String(row[keyIn(editorRows, 'property')] || '').trim());
  const addedMulti = !!multi && !editorRows.some(isMultiRow);
  if (addedMulti) {
    editorRows.push(rowLike(editorRows, { block: toClass(name), property: 'multi' }));
    if (!names.includes('editor')) names.push('editor');
  }
  const { ':sheetname': sheetName, ':type': sheetType, ...blockSheet } = sheets[blocks];
  sheets[blocks] = { ...blockSheet, ...sheetOf(blockRows) };
  if (names.includes('editor')) sheets.editor = { ...(sheets.editor || {}), ...sheetOf(editorRows) };
  if (!isMulti && names.length === 1) {
    return { json: { ...sheets.data, ':type': 'sheet' }, addedBlock, addedMulti };
  }
  const result = {
    ...Object.fromEntries(names.map((n) => [n, sheets[n]])),
    ':names': names,
    ':version': json?.[':version'] ?? 3,
    ':type': 'multi-sheet',
  };
  return { json: result, addedBlock, addedMulti };
}

/* Where things are saved */

/**
 * The DA source for a content.da.live, admin.da.live or aem.page/aem.live URL:
 * {url: admin.da.live/source/org/site/path.html (or .json), path: '/path'}, or null.
 */
export function daSource(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  let parts;
  if (url.hostname === 'content.da.live') parts = url.pathname.split('/').slice(1);
  else if (url.hostname === 'admin.da.live' && url.pathname.startsWith('/source/')) {
    parts = url.pathname.split('/').slice(2);
  } else {
    const host = /^([a-z0-9-]+)\.(aem|hlx)\.(page|live)$/i.exec(url.hostname)?.[1].split('--');
    if (host?.length !== 3) return null;
    parts = [host[2], host[1], ...url.pathname.split('/').slice(1)];
  }
  const [org, site, ...rest] = parts;
  if (!org || !site) return null;
  let path = `/${rest.join('/')}`.replace(/\/$/, '/index').replace(/(\.plain)?\.html$/, '');
  const json = path.endsWith('.json');
  if (json) path = path.replace(/\.json$/, '');
  return {
    url: `${DA_ADMIN}/source/${org}/${site}${path}${json ? '.json' : '.html'}`,
    path,
  };
}

/** Where a library page opens in Document Authoring, or '' for a sheet or another host. */
export function daEditUrl(href) {
  const source = daSource(href);
  if (!source?.url.endsWith('.html')) return '';
  return `https://da.live/edit#${source.url.slice(`${DA_ADMIN}/source`.length).replace(/\.html$/, '')}`;
}

const shownPath = (href) => daSource(href)?.path || String(href).replace(/^[a-z]+:/, '');

/**
 * The library page for a block: the one the index lists, else a new page next to the
 * other block pages (or next to the index) named after the block.
 */
export function libraryPageFor(libraryBlocks, indexUrl, name) {
  const rows = libraryBlocks || [];
  const entry = rows.find((row) => sameBlock(row.name, name));
  if (entry) return { url: entry.path, listed: true };
  const sibling = rows.find((row) => row.path)?.path;
  const base = sibling ? sibling.replace(/\/[^/]*$/, '') : String(indexUrl).replace(/(\.plain)?\.json(\?.*)?$/, '');
  return { url: `${base}/${toClass(name)}`, listed: false };
}

/** Reads and writes DA sources (pages as HTML, sheets as JSON) with the IMS token. */
export function daStore(fetcher) {
  const sourceOf = (href) => {
    const source = daSource(href);
    if (!source) throw new Error(`${href} is not in Document Authoring`);
    return source;
  };
  return {
    async read(href) {
      const { url, path } = sourceOf(href);
      const resp = await fetcher(url);
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`Could not read ${path} (${resp.status})`);
      return resp.text();
    },
    async write(href, body, type) {
      const { url, path } = sourceOf(href);
      const form = new FormData();
      form.append('data', new Blob([body], { type }));
      const resp = await fetcher(url, { method: 'PUT', body: form });
      if (!resp.ok) throw new Error(`Could not save ${path} (${resp.status})`);
    },
    /** Whether the signed-in person may change this source (DA's x-da-actions). */
    async writable(href) {
      try {
        const resp = await fetcher(sourceOf(href).url);
        return resp.ok && /=.*\bwrite\b/.test(resp.headers.get('x-da-actions') || '');
      } catch {
        return false;
      }
    },
  };
}

const ACTIONS = {
  'create-page': (title, where) => `Create ${where} with an example ${title} block and its field names`,
  'add-example': (title, where) => `Add an example ${title} block with its field names to ${where}`,
  'add-fields': (title, where) => `Add the field names to the ${title} example in ${where}`,
  'replace-fields': (title, where) => `Replace the field names of the ${title} example in ${where}`,
};

const RULE_ACTIONS = {
  'add-rules': (title) => `Add the field limits to the ${title} example`,
  'replace-rules': (title) => `Replace the field limits of the ${title} example`,
  'remove-rules': (title) => `Remove the field limits from the ${title} example`,
};

/**
 * What saving does to the `field-rules` table once an author changed the limits, given
 * whether the library page has one (`hadRules`).
 */
export function limitsChange(rows, hadRules, title) {
  const has = fieldLimits(rows).length > 0;
  if (!has) return hadRules ? RULE_ACTIONS['remove-rules'](title) : '';
  return RULE_ACTIONS[hadRules ? 'replace-rules' : 'add-rules'](title);
}

/**
 * What saving will change, without saving: the new page and index, and a list of
 * changes and notes to show before saving.
 * @param {object} opts {name, title, variants, rows, multi, noun, exampleHtml, pageUrl, indexUrl}
 */
export function planNames(pageHtml, indexJson, opts, Parser = DOMParser) {
  const { title, pageUrl, indexUrl } = opts;
  const page = withFieldsTable(pageHtml, {
    ...opts, table: fieldsTable(opts.rows), rulesTable: fieldRulesTable(opts.rows),
  }, Parser);
  const index = withLibraryRows(indexJson, { ...opts, path: pageUrl });
  const changes = [ACTIONS[page.action](title, shownPath(pageUrl))];
  const rulesChange = page.rulesAction ? RULE_ACTIONS[page.rulesAction](title) : '';
  if (rulesChange) changes.push(rulesChange);
  if (index.addedBlock) changes.push(`List ${title} in the block library (${shownPath(indexUrl)})`);
  if (index.addedMulti) {
    changes.push(`Mark ${title} as repeating, so one row of names covers every ${String(opts.noun || 'item').toLowerCase()}`);
  }
  const notes = [
    'The names apply to every author, on every page that uses this block.',
    'If the library page is open in Document Authoring, reload it before you edit it.',
  ];
  if (/\.(aem|hlx)\.(page|live)\//.test(pageUrl)) {
    notes.splice(1, 0, 'Other authors see the names after the library page is previewed.');
  }
  return {
    page, index, action: page.action, changes, notes, rulesChange, hadRules: page.hadRules,
  };
}

/**
 * Saves the names: reads the page and index again (so nothing saved meanwhile is lost),
 * writes the page, then the index if it changed.
 * @param {{read: Function, write: Function}} store
 */
export async function saveNames(store, opts, Parser = DOMParser) {
  const [pageHtml, indexText] = await Promise.all([
    store.read(opts.pageUrl),
    store.read(opts.indexUrl),
  ]);
  let indexJson = null;
  try {
    indexJson = indexText ? JSON.parse(indexText) : null;
  } catch {
    throw new Error('The block library list is not valid JSON, so it was left as it is');
  }
  const plan = planNames(pageHtml, indexJson, opts, Parser);
  await store.write(opts.pageUrl, plan.page.html, 'text/html');
  if (plan.index.addedBlock || plan.index.addedMulti) {
    await store.write(opts.indexUrl, JSON.stringify(plan.index.json), 'application/json');
  }
  return plan;
}
