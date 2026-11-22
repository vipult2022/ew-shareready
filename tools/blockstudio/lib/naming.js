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
import { DA_ADMIN, fieldRule } from './rules.js';
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
 * Suggested names for each field of an example block. A block of items is named by its
 * first item, which names every item; other blocks are named row by row, and their
 * settings rows are left out. A rule from the site's `block-studio` sheet keeps its
 * label; other names in an item start with the item's noun (from the rules, the code,
 * or the block name).
 * @returns {{multi: boolean, noun: string, rows: object[]}} rows are
 *   {option: true, size} or {n, title, cells: [[{type, label, auto, units, text}]]}
 */
export function suggestNames(blockEl, hints = {}, opts = {}) {
  const { rules = null, codeNoun: fromCode = '' } = opts;
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
      const ruled = fieldRule(rules, label, field.type, slot?.auto || label).label;
      const auto = ruled || label;
      return {
        type: field.type,
        label: ruled || (multi ? itemLabel(noun, label) : label),
        auto,
        units: field.units ?? 1,
        text: clip(fieldText(field, doc)),
      };
    });
  };
  if (multi) {
    const first = view.groups[0];
    if (!first) return { multi, noun, rows: [] };
    const cells = first.row.cells.map((cell, c) => nameCell(cell, first.cells[c] || []));
    return { multi, noun, rows: [{ n: 1, title: `Every ${noun.toLowerCase()}`, cells }] };
  }
  const content = model.rows.filter((row) => row.kind === 'item');
  const rows = model.rows.map((row) => {
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
  return { multi, noun, rows };
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
 * The library page with the `fields` table in the example's `library-metadata`. Adds
 * the metadata, the example (a new section with a heading) or the whole page as needed.
 * @returns {{html: string, action: 'create-page'|'add-example'|'add-fields'|'replace-fields'}}
 */
export function withFieldsTable(pageHtml, opts, Parser = DOMParser) {
  const {
    name, title, variants = [], table, exampleHtml,
  } = opts;
  const meta = `<div class="library-metadata">${metaRow('fields', table)}</div>`;
  const section = `<div><h2>${escapeHtml(title)}</h2>${exampleHtml}${meta}</div>`;
  if (!String(pageHtml || '').trim()) {
    return {
      html: `<body><header></header><main>${section}</main><footer></footer></body>`,
      action: 'create-page',
    };
  }
  const doc = parseHtml(pageHtml, Parser);
  const main = doc.querySelector('main');
  if (!main) throw new Error('The library page is not a Document Authoring page, so it was left as it is');
  const example = pickExample(doc, name, variants);
  let action;
  if (!example) {
    main.insertAdjacentHTML('beforeend', section);
    action = 'add-example';
  } else {
    const next = nextDiv(example);
    const metaEl = classesOf(next)[0] === 'library-metadata' ? next : null;
    const row = metaEl && [...metaEl.children]
      .find((r) => /^fields$/i.test(r.children[0]?.textContent.trim() || ''));
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
  }
  const body = doc.querySelector('body');
  const html = body?.contains(main) ? body.outerHTML
    : `<body><header></header>${main.outerHTML}<footer></footer></body>`;
  return { html, action };
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

/**
 * What saving will change, without saving: the new page and index, and a list of
 * changes and notes to show before saving.
 * @param {object} opts {name, title, variants, rows, multi, noun, exampleHtml, pageUrl, indexUrl}
 */
export function planNames(pageHtml, indexJson, opts, Parser = DOMParser) {
  const { title, pageUrl, indexUrl } = opts;
  const page = withFieldsTable(pageHtml, { ...opts, table: fieldsTable(opts.rows) }, Parser);
  const index = withLibraryRows(indexJson, { ...opts, path: pageUrl });
  const changes = [ACTIONS[page.action](title, shownPath(pageUrl))];
  if (index.addedBlock) changes.push(`List ${title} in the block library (${shownPath(indexUrl)})`);
  if (index.addedMulti) {
    changes.push(`Mark ${title} as repeating, so one row of names covers every ${String(opts.noun || 'item').toLowerCase()}`);
  }
  const notes = ['If the library page is open in Document Authoring, reload it before you edit it.'];
  if (/\.(aem|hlx)\.(page|live)\//.test(pageUrl)) {
    notes.unshift('Other authors see the names after the library page is previewed.');
  }
  return {
    page, index, action: page.action, changes, notes,
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
