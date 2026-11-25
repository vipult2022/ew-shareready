/**
 * Block Studio's block model. A block's rows become Items (or fixed groups) and
 * Block options (key/value settings rows such as `theme | dark`). Each cell becomes
 * typed fields. Edits are small ops applied to the model, and buildBlock() writes
 * the block back, keeping the original HTML of everything that was not edited.
 */

import { escapeHtml } from './dom.js';
import { cleanFlow, cleanInline, textOf } from './sanitize.js';
import { blockName, cleanBlock, classesOf } from './live.js';

export const FIELD_TYPES = ['heading', 'text', 'image', 'button', 'icon', 'raw'];
export const ICON_TOKEN = /^:([a-z0-9][a-z0-9_-]*):$/i;

const BLOCKISH = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'DIV', 'TABLE',
  'BLOCKQUOTE', 'PRE', 'PICTURE', 'IMG', 'HR', 'VIDEO', 'IFRAME', 'FIGURE']);
const SETTING_WORDS = new Set(['theme', 'style', 'layout', 'autoplay', 'interval', 'background',
  'color', 'colour', 'variant', 'align', 'alignment', 'size', 'columns', 'id', 'anchor', 'type',
  'mode', 'position', 'delay', 'speed', 'loop', 'height', 'width', 'ratio', 'aspect-ratio',
  'image-position', 'media-position', 'text-align', 'spacing', 'padding', 'overlay', 'max-items',
  'limit', 'source', 'filter', 'sort', 'tag', 'tags', 'category', 'duration', 'effect', 'icon']);
const NOUNS = [
  [/card/, 'Card'], [/carousel|slide/, 'Slide'], [/faq/, 'Question'], [/accordion/, 'Panel'],
  [/tab/, 'Tab'], [/step|timeline/, 'Step'], [/testimonial|quote/, 'Quote'], [/logo/, 'Logo'],
  [/gallery/, 'Image'], [/stat/, 'Stat'], [/feature/, 'Feature'], [/team|people|profile/, 'Person'],
  [/column|table/, 'Row'],
];
const REPEATER = /card|carousel|slide|accordion|faq|tab|timeline|step|testimonial|quote|logo|gallery|stat|feature|team|teaser|tile|grid|list|link|alternating|item|news|people/;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

export const optionKey = (text) => norm(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const toClass = optionKey;

export function nounFor(name) {
  const key = String(name || '').toLowerCase();
  return NOUNS.find(([re]) => re.test(key))?.[1] || 'Item';
}

const isElement = (node) => node.nodeType === 1;
const meaningful = (node) => isElement(node) || (node.nodeType === 3 && node.textContent.trim());

/* Reading fields */

function buttonOf(el) {
  const links = [...(el.tagName === 'A' ? [el] : el.querySelectorAll('a'))];
  if (links.length !== 1) return null;
  const [a] = links;
  const text = norm(a.textContent);
  if (!text || norm(el.textContent) !== text || a.querySelector('img, picture')) return null;
  let strong = false;
  let em = false;
  for (let node = a.parentElement; node && node !== el.parentElement; node = node.parentElement) {
    if (['STRONG', 'B'].includes(node.tagName)) strong = true;
    if (['EM', 'I'].includes(node.tagName)) em = true;
    if (node === el) break;
  }
  let style = 'link';
  if (strong && em) style = 'accent';
  else if (strong) style = 'primary';
  else if (em) style = 'secondary';
  return {
    type: 'button', text, href: a.getAttribute('href') || '', title: a.getAttribute('title') || '', style,
  };
}

function iconOf(el) {
  if (el.querySelector?.('a, img')) return null;
  const token = norm(el.textContent).match(ICON_TOKEN);
  if (token) return { type: 'icon', name: token[1].toLowerCase(), format: 'token' };
  const spans = el.querySelectorAll?.('span.icon') || [];
  if (spans.length === 1 && !norm(el.textContent)) {
    const name = classesOf(spans[0]).find((c) => c.startsWith('icon-'))?.slice(5);
    if (name) return { type: 'icon', name, format: 'span' };
  }
  return null;
}

function imageOf(el) {
  const images = el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')];
  if (images.length !== 1 || norm(el.textContent)) return null;
  const [img] = images;
  return { type: 'image', src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' };
}

function describe(el, doc) {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    if (el.querySelector('img')) return { type: 'raw' };
    return { type: 'heading', level: Number(tag[1]), value: cleanInline(el.innerHTML, doc) };
  }
  if (el.querySelector('img') || tag === 'IMG') return imageOf(el) || { type: 'raw' };
  if (tag === 'P') return iconOf(el) || buttonOf(el) || { type: 'text', value: cleanFlow(el.outerHTML, doc) };
  if (tag === 'UL' || tag === 'OL') return { type: 'text', value: cleanFlow(el.outerHTML, doc) };
  if (tag === 'BLOCKQUOTE' && !el.querySelector('h1, h2, h3, h4, h5, h6, div, table, pre, video, iframe')) {
    return { type: 'text', value: cleanFlow(el.outerHTML, doc) };
  }
  return { type: 'raw' };
}

/** A short single paragraph, which before a heading is that heading's eyebrow. */
function shortText(field, doc) {
  return !/<(ul|ol|h[1-6]|blockquote)\b/.test(field.value)
    && (field.value.match(/<p>/g) || []).length <= 1 && textOf(field.value, doc).length <= 40;
}

/** How many elements the block library's `fields` labels count for this node. */
function unitsOf(node) {
  if (!isElement(node)) return 0;
  return node.tagName === 'BLOCKQUOTE' ? node.children.length : 1;
}

/**
 * Splits a cell into fields. Each field keeps its original markup in `html` so an
 * unedited field is written back exactly as it was. Consecutive paragraphs, lists and
 * quotes form one rich text field; `units` counts the elements it covers. Headings
 * before the text are fields of their own (heading, subheading); a heading after it
 * is a subhead inside the text, unless the text is a short eyebrow above that heading.
 */
function parseCell(cellEl, rowId, c, doc) {
  const nodes = [...cellEl.childNodes].filter(meaningful);
  const inline = !nodes.some((node) => isElement(node) && BLOCKISH.has(node.tagName));
  const fields = [];
  if (inline) {
    if (nodes.length) {
      const field = iconOf(cellEl) || buttonOf(cellEl)
        || { type: 'text', value: cleanFlow(`<p>${cellEl.innerHTML}</p>`, doc) };
      fields.push({
        ...field, html: cellEl.innerHTML, inline: true, units: 1,
      });
    }
  } else {
    nodes.forEach((node) => {
      const html = isElement(node) ? node.outerHTML : escapeHtml(node.textContent);
      const field = isElement(node) ? describe(node, doc)
        : { type: 'text', value: cleanFlow(`<p>${html}</p>`, doc) };
      const last = fields[fields.length - 1];
      const subhead = field.type === 'heading' && last?.type === 'text'
        && (fields.some((f) => f.type === 'heading') || !shortText(last, doc));
      if ((field.type === 'text' || subhead) && last?.type === 'text') {
        last.html += html;
        last.value = cleanFlow(last.html, doc);
        last.units += unitsOf(node);
        return;
      }
      fields.push({
        ...field, html, inline: false, units: unitsOf(node),
      });
    });
  }
  fields.forEach((field, f) => {
    field.id = `${rowId}.${c}.${f}`;
    field.dirty = false;
  });
  return {
    inline, html: cellEl.innerHTML, fields, dirty: false,
  };
}

const COMPLEX = 'a, h1, h2, h3, h4, h5, h6, ul, ol, table, div, video, iframe';

/** A `key | value` settings row. Image options (from `imageKeys`) hold one picture. */
function optionOf(rowEl, imageKeys) {
  const cells = [...rowEl.children];
  if (cells.length !== 2) return null;
  const [keyEl, valueEl] = cells;
  if (keyEl.querySelector(`img, picture, ${COMPLEX}`) || keyEl.querySelectorAll('p').length > 1) return null;
  const keyText = norm(keyEl.textContent);
  if (!keyText || keyText.length > 30 || keyText.split(' ').length > 3 || /[.!?:]$/.test(keyText)) return null;
  if (ICON_TOKEN.test(keyText)) return null;
  const key = optionKey(keyText);
  const base = {
    key, keyText, keyHtml: keyEl.innerHTML, valueWrap: !!valueEl.querySelector('p'),
  };
  const img = valueEl.querySelector('img');
  if (img && imageKeys?.has(key)) {
    if (valueEl.querySelector(COMPLEX) || valueEl.querySelectorAll('img').length > 1 || norm(valueEl.textContent)) return null;
    return {
      ...base, image: true, value: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', valueHtml: valueEl.innerHTML,
    };
  }
  if (valueEl.querySelector(`img, picture, ${COMPLEX}`) || valueEl.querySelectorAll('p').length > 1) return null;
  const value = norm(valueEl.textContent);
  if (value.length > 80) return null;
  return { ...base, value };
}

const lowerSlug = (text) => /^[a-z][a-z0-9 _-]*$/.test(text);

function typesOf(row) {
  return new Set(row.cells.flatMap((cell) => cell.fields.map((field) => field.type)));
}

function overlap(a, b) {
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((type) => b.has(type)).length / union.size;
}

/**
 * Reads a block element into a model.
 * @param {Element} element the block div (may carry EW instrumentation)
 * @param {object} [hints]
 * @param {Set<string>} [hints.knownKeys] option keys known from the options or rules sheets
 * @param {string[]} [hints.options] keys the rules sheet forces to be options
 * @param {string[]|'all'} [hints.items] keys forced to be items ('all' = no options)
 * @param {string} [hints.noun] item name from the rules sheet
 * @param {boolean} [hints.multi] the library's `editor` sheet marks it as repeating items
 * @param {Set<string>} [hints.imageKeys] option keys whose value is a picture
 * @param {object[]} [hints.schema] the block's `fields` sheet rows ({c, type, label}), and
 *   names from its block library example (`labelOnly`, which only rename fields)
 */
export function parseBlock(element, hints = {}) {
  const el = cleanBlock(element);
  const doc = el.ownerDocument;
  const name = blockName(el);
  const rowEls = [...el.children].filter((row) => row.tagName === 'DIV');
  const candidates = rowEls.map((rowEl) => optionOf(rowEl, hints.imageKeys));
  const known = hints.knownKeys || new Set();
  const forced = new Set((hints.options || []).map(optionKey));
  const itemsAll = hints.items === 'all';
  const forcedItems = new Set(Array.isArray(hints.items) ? hints.items.map(optionKey) : []);
  const hasContent = candidates.some((c) => !c);
  const lead = candidates.findIndex((c) => !c);
  const tail = candidates.length - 1 - [...candidates].reverse().findIndex((c) => !c);
  const allLower = candidates.every((c) => c && lowerSlug(c.keyText));
  const isOption = candidates.map((cand, i) => {
    if (!cand || itemsAll || forcedItems.has(cand.key)) return false;
    if (forced.has(cand.key) || known.has(cand.key)) return true;
    if (!hasContent) return allLower && rowEls.length <= 8;
    const edge = i < lead || i > tail;
    return edge && (lowerSlug(cand.keyText) || SETTING_WORDS.has(cand.key));
  });
  const rows = rowEls.map((rowEl, i) => {
    const id = `r${i}`;
    if (isOption[i]) {
      return {
        id, kind: 'option', html: rowEl.outerHTML, dirty: false, option: candidates[i],
      };
    }
    const cells = [...rowEl.children].map((cellEl, c) => parseCell(cellEl, id, c, doc));
    return {
      id, kind: 'item', html: rowEl.outerHTML, dirty: false, cells, cellCount: cells.length,
    };
  });
  const content = rows.filter((row) => row.kind === 'item');
  const repeater = REPEATER.test(name) || !!hints.noun || !!hints.multi
    || !!hints.schema?.some((def) => !def.labelOnly);
  let mode = 'groups';
  if (content.length >= 2) {
    const sameCells = content.every((row) => row.cells.length === content[0].cells.length);
    const rich = content.reduce((a, b) => (typesOf(b).size > typesOf(a).size ? b : a));
    const similar = content.every((row) => overlap(typesOf(row), typesOf(rich)) >= 0.5);
    if (repeater || (sameCells && similar)) mode = 'items';
  } else if (content.length === 1 && repeater) mode = 'items';
  return {
    name,
    variants: classesOf(el).slice(1),
    rows,
    mode,
    noun: hints.noun || nounFor(name),
    schema: hints.schema || [],
    seq: 0,
  };
}

/* Finding things */

export function items(model) {
  return model.rows.filter((row) => row.kind === 'item');
}

export function options(model) {
  return model.rows.filter((row) => row.kind === 'option');
}

const IGNORE = /^ignore$/i;

/**
 * Names a cell's fields from its labels, which name each paragraph, heading, list or
 * picture in order. Consecutive paragraphs are one field here, so it takes their labels
 * together ("Title & Body"). Labels that don't line up give null.
 */
function nameFields(fields, labels) {
  const units = fields.map((field) => field.units ?? 1);
  let groups;
  if (labels.length === units.reduce((a, b) => a + b, 0)) {
    let at = 0;
    groups = units.map((count) => {
      at += count;
      return labels.slice(at - count, at);
    });
  } else if (labels.length === fields.length) groups = labels.map((label) => [label]);
  else return null;
  return fields.map((field, i) => ({
    type: field.type,
    label: [...new Set(groups[i].map(norm).filter((label) => label && !IGNORE.test(label)))].join(' & '),
  }));
}

/**
 * Field names from a block library example and its `library-metadata` `fields` table
 * (Block Inspector's format): label rows mirror the example's rows and cells. For a
 * `multi` block (or one label row) the first row names every item, however many there
 * are. Otherwise the rows name the example's rows in order, and in a block of items the
 * first item's names also name any items after them. IGNORE or an empty label keeps
 * the automatic name, and a cell whose labels don't line up with its content is skipped.
 * @param {Element} blockEl the example block
 * @param {string[][][]} labelRows label rows → cells → labels
 * @param {object} [hints] the block's parse hints
 * @returns {object[]} [{c, r?, type, label, labelOnly}]
 */
export function exampleFields(blockEl, labelRows, hints = {}) {
  if (!labelRows?.length) return [];
  const model = parseBlock(blockEl, hints);
  const content = items(model);
  const shared = labelRows.length === 1 || !!hints.multi;
  const defs = [];
  (shared ? labelRows.slice(0, 1) : labelRows).forEach((cells, j) => {
    const row = shared ? content.find((item) => item.cells.length === cells.length) : model.rows[j];
    if (row?.kind !== 'item' || row.cells.length !== cells.length) return;
    const at = shared ? {} : { r: content.indexOf(row) };
    cells.forEach((labels, c) => {
      nameFields(row.cells[c].fields, labels)?.forEach(({ type, label }) => {
        defs.push({
          c, ...at, type, label, labelOnly: true,
        });
      });
    });
  });
  if (!shared && model.mode === 'items') {
    // Items beyond the example's rows take the first item's names.
    const first = defs.find((def) => def.r != null)?.r;
    defs.push(...defs.filter((def) => def.r === first).map(({ r, ...def }) => def));
  }
  return defs;
}

export function findField(model, id) {
  let hit = null;
  model.rows.some((row) => row.kind === 'item' && row.cells.some((cell, c) => {
    const f = cell.fields.findIndex((field) => field.id === id);
    if (f >= 0) {
      hit = {
        row, cell, c, field: cell.fields[f], f,
      };
    }
    return f >= 0;
  }));
  return hit;
}

/** The visible text of a field, used for counters, checks and titles. */
export function fieldText(field, doc) {
  if (!field) return '';
  if (field.type === 'heading' || field.type === 'text') return textOf(field.value, doc);
  if (field.type === 'button') return norm(field.text);
  if (field.type === 'image') return norm(field.alt);
  if (field.type === 'icon') return field.name || '';
  return '';
}

export function isEmptyField(field, doc) {
  if (field.type === 'image') return !field.src;
  if (field.type === 'button') return !norm(field.text) && !field.href;
  if (field.type === 'raw') return false;
  return !fieldText(field, doc);
}

/* Layout: templates, labels and missing fields */

const SLOT_LABELS = {
  heading: 'Heading', text: 'Text', image: 'Image', button: 'Button', icon: 'Icon', raw: 'Other content',
};
const BUTTON_LABELS = {
  primary: 'Primary button', secondary: 'Secondary button', accent: 'Accent button', link: 'Link',
};

export function labelFields(fields, doc) {
  let headings = 0;
  let texts = 0;
  let seenHeading = false;
  const labels = fields.map((field, i) => {
    if (!field) return '';
    switch (field.type) {
      case 'heading':
        headings += 1;
        seenHeading = true;
        return headings === 1 ? 'Heading' : 'Subheading';
      case 'text': {
        const next = fields.slice(i + 1).find(Boolean);
        const short = shortText(field, doc) || field.placeholder === 'Eyebrow';
        if (!seenHeading && next?.type === 'heading' && short) return 'Eyebrow';
        if (/^<(ul|ol)>/.test(field.value) && !/<p>/.test(field.value)) return 'List';
        texts += 1;
        return texts === 1 ? 'Description' : 'More text';
      }
      case 'button': return BUTTON_LABELS[field.style] || 'Link';
      default: return SLOT_LABELS[field.type];
    }
  });
  const seen = {};
  const totals = labels.reduce((acc, label) => ({ ...acc, [label]: (acc[label] || 0) + 1 }), {});
  return labels.map((label) => {
    if (!label || totals[label] < 2) return label;
    seen[label] = (seen[label] || 0) + 1;
    return seen[label] === 1 ? label : `${label} ${seen[label]}`;
  });
}

function matchSlots(fields, template) {
  const slots = template.map(() => -1);
  let i = 0;
  fields.forEach((field, f) => {
    let k = i;
    while (k < template.length && template[k].type !== field.type) k += 1;
    if (k < template.length) {
      slots[k] = f;
      i = k + 1;
    }
  });
  return slots;
}

function buildTemplate(rows, c) {
  const seqs = rows.map((row) => row.cells[c]?.fields || []);
  const template = [...seqs.reduce((a, b) => (b.length > a.length ? b : a), [])];
  seqs.forEach((fields) => {
    let i = 0;
    fields.forEach((field) => {
      let k = i;
      while (k < template.length && template[k].type !== field.type) k += 1;
      if (k < template.length) i = k + 1;
      else {
        template.splice(i, 0, field);
        i += 1;
      }
    });
  });
  return template;
}

const itemTitle = (noun, n, fields, doc) => {
  const lead = fields.find((field) => field?.type === 'heading' && fieldText(field, doc))
    || fields.find((field) => field?.type === 'text' && fieldText(field, doc))
    || fields.find((field) => field?.type === 'button' && fieldText(field, doc));
  const text = lead ? fieldText(lead, doc) : '';
  const short = text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
  return { title: `${noun} ${n}`, subtitle: short };
};

/**
 * Pairs definitions with slots of the same type, keeping both in order and pairing as
 * many as possible, so an optional field (an eyebrow) that's missing doesn't shift names.
 * → slot index per definition, or -1.
 */
function align(types, defs) {
  const dp = Array.from({ length: defs.length + 1 }, () => new Array(types.length + 1).fill(0));
  for (let a = defs.length - 1; a >= 0; a -= 1) {
    for (let b = types.length - 1; b >= 0; b -= 1) {
      dp[a][b] = defs[a].type === types[b] ? dp[a + 1][b + 1] + 1
        : Math.max(dp[a + 1][b], dp[a][b + 1]);
    }
  }
  const match = defs.map(() => -1);
  let a = 0;
  let b = 0;
  while (a < defs.length && b < types.length) {
    if (defs[a].type === types[b]) {
      match[a] = b;
      a += 1;
      b += 1;
    } else if (dp[a + 1][b] >= dp[a][b + 1]) a += 1;
    else b += 1;
  }
  return match;
}

/**
 * Names a column's slots from the `fields` sheet: each definition names the slot of its
 * type it lines up with. With `insert`, a definition no slot matches is added as an
 * empty slot, so every item offers it ("Add card background"). Names from the block
 * library (`labelOnly`) only rename; an empty one (IGNORE) keeps the automatic name.
 */
function withSchema(template, defs, insert) {
  const out = template.map((sample) => ({ ...sample }));
  const match = align(out.map((sample) => sample.type), defs);
  const result = [];
  let next = 0;
  defs.forEach((def, d) => {
    if (match[d] >= 0) {
      while (next <= match[d]) {
        result.push(out[next]);
        next += 1;
      }
      if (def.label) {
        result[result.length - 1].schemaLabel = def.label;
        result[result.length - 1].schemaSource = def.labelOnly ? 'library' : 'sheet';
      }
    } else if (insert && !def.labelOnly) {
      result.push({
        type: def.type, schemaLabel: def.label, schemaSource: 'sheet', schema: true,
      });
    }
  });
  return [...result, ...out.slice(next)];
}

/** The definitions for cell `c` of content row `r` (definitions without `r` fit every row). */
/** Definitions for column c: shared ones, plus row r's own when r is given. */
const schemaFor = (model, c, r) => (model.schema || [])
  .filter((def) => def.c === c && (def.r == null || def.r === r));

/** Row r's own names (from a library example with a label row per row), per field. */
const rowNames = (model, c, r, fields) => {
  const defs = (model.schema || []).filter((def) => def.c === c && def.r === r);
  return defs.length ? withSchema(fields, defs, false).map((field) => field.schemaLabel) : [];
};

const shortLine = (field, doc) => field.type === 'text' && fieldText(field, doc).length <= 80
  && (field.value.match(/<p>/g) || []).length <= 1 && !/<(ul|ol)\b/.test(field.value);

/**
 * With no headings, an item whose first text column is one short line and whose later
 * columns hold more text (an accordion's question and answer) is titled by that line.
 */
function titleColumn(templates, rows, doc) {
  if (templates.some((template) => template.some((sample) => !sample.schema && sample.type === 'heading'))) return -1;
  const c = templates.findIndex((template) => template.some((sample) => sample.type === 'text'));
  if (c < 0) return -1;
  const own = templates[c].filter((sample) => !sample.schema);
  const later = templates.slice(c + 1).some((template) => template.some((sample) => sample.type === 'text'));
  if (own.length !== 1 || own[0].type !== 'text' || !later) return -1;
  const fits = rows.every((row) => (row.cells[c]?.fields || [])
    .every((field) => shortLine(field, doc)));
  return fits ? c : -1;
}

/**
 * What the panel shows: options, then items (or groups) with labelled slots. A slot
 * with no field is a field this item is missing compared with the others, or one the
 * block's `fields` sheet declares. Names come from the `fields` sheet, then the block
 * library's example, then the content; a slot's `source` is 'sheet', 'library' or ''.
 */
export function layout(model, doc) {
  const rows = items(model);
  const groups = [];
  if (model.mode === 'items') {
    const cellCount = Math.max(
      0,
      ...rows.map((row) => row.cells.length),
      ...(model.schema || []).filter((def) => !def.labelOnly).map((def) => def.c + 1),
    );
    const templates = Array.from(
      { length: cellCount },
      (_, c) => withSchema(buildTemplate(rows, c), schemaFor(model, c), true),
    );
    const templateLabels = templates.map((template) => labelFields(
      template.map((sample) => (sample.schema ? null : sample)),
      doc,
    ));
    const titled = titleColumn(templates, rows, doc);
    rows.forEach((row, n) => {
      const cells = templates.map((template, c) => {
        const fields = row.cells[c]?.fields || [];
        const slots = matchSlots(fields, template);
        const labels = labelFields(slots.map((f) => (f >= 0 ? fields[f] : null)), doc);
        const own = rowNames(model, c, n, fields);
        return template.map((sample, k) => {
          const field = slots[k] >= 0 ? fields[slots[k]] : null;
          let label = field ? labels[k] : templateLabels[c][k];
          if (field?.type === 'button') label = labels[k];
          if (c === titled && sample.type === 'text') label = 'Title';
          const auto = label;
          if (sample.schemaLabel) label = sample.schemaLabel;
          let source = sample.schemaLabel ? sample.schemaSource : '';
          if (field && own[slots[k]]) {
            label = own[slots[k]];
            source = 'library';
          }
          const at = slots.slice(0, k).filter((f) => f >= 0).length;
          return {
            field, type: sample.type, label, auto, source, c, slot: k, sample, at,
          };
        });
      });
      const all = cells.flat().map((slot) => slot.field);
      groups.push({
        row, kind: 'item', n: n + 1, cells, ...itemTitle(model.noun, n + 1, all, doc),
      });
    });
  } else {
    rows.forEach((row, n) => {
      const multi = rows.length === 1 && row.cells.length > 1;
      const parts = multi
        ? row.cells.map((cell, c) => ({ cells: [cell], c }))
        : [{ cells: row.cells, c: 0 }];
      parts.forEach(({ cells: partCells, c: firstCell }) => {
        const cells = partCells.map((cell, i) => {
          const labels = labelFields(cell.fields, doc);
          const named = withSchema(cell.fields, schemaFor(model, firstCell + i, n), false);
          return cell.fields.map((field, k) => ({
            field,
            type: field.type,
            label: named[k].schemaLabel || labels[k],
            auto: labels[k],
            source: named[k].schemaLabel ? named[k].schemaSource : '',
            c: firstCell + i,
            slot: k,
            sample: field,
            at: k,
          }));
        });
        const all = cells.flat().map((slot) => slot.field);
        const onlyImage = all.length && all.every((field) => field.type === 'image');
        let title = multi ? `Column ${firstCell + 1}` : `Row ${n + 1}`;
        if (rows.length === 1 && !multi) title = 'Content';
        if (onlyImage) title = multi ? `Column ${firstCell + 1}: image` : 'Image';
        groups.push({
          row, kind: 'group', n: n + 1, cells, title, subtitle: onlyImage ? '' : itemTitle('', 0, all, doc).subtitle,
        });
      });
    });
  }
  return {
    options: options(model).map((row) => ({ row, ...row.option })),
    groups,
  };
}

/* Edits */

function placeholderFor(type, sample, label) {
  switch (type) {
    case 'heading': return { level: sample?.level || 3, value: label === 'Subheading' ? 'Subheading' : 'Heading' };
    case 'text': return { value: `<p>${label === 'Eyebrow' ? 'Eyebrow' : 'Add a short description.'}</p>`, placeholder: label };
    case 'button': return { text: 'Learn more', href: '', style: sample?.style || 'link' };
    case 'image': return { src: '', alt: '' };
    case 'icon': return { name: sample?.name || '', format: sample?.format || 'token' };
    default: return {};
  }
}

function renumber(row) {
  row.cells.forEach((cell, c) => cell.fields.forEach((field, f) => {
    field.id = `${row.id}.${c}.${f}`;
  }));
}

function touch(row, cell) {
  row.dirty = true;
  if (cell) cell.dirty = true;
}

function insertAfterItem(model, row, afterId) {
  const list = model.rows;
  let at = afterId ? list.findIndex((r) => r.id === afterId) : -1;
  if (at < 0) {
    const all = items(model);
    at = all.length ? list.indexOf(all[all.length - 1]) : list.findIndex((r) => r.kind === 'option') - 1;
    if (at < -1) at = list.length - 1;
  }
  list.splice(at + 1, 0, row);
}

function blankCopy(src, labels) {
  const row = clone(src);
  row.cells.forEach((cell, c) => {
    cell.dirty = true;
    cell.fields.forEach((field, f) => {
      if (['heading', 'text', 'button'].includes(field.type)) {
        Object.assign(field, placeholderFor(field.type, field, labels?.[c]?.[f]));
        if (field.type === 'button') field.text = src.cells[c].fields[f].text;
        field.dirty = true;
      }
    });
  });
  return row;
}

/**
 * Applies one edit to the model, in place. Returns false when its target is gone
 * (for example after someone else deleted that item).
 */
export function applyOp(model, op, doc) {
  switch (op.t) {
    case 'set': {
      const hit = findField(model, op.id);
      if (!hit) return false;
      Object.assign(hit.field, op.props);
      hit.field.dirty = true;
      touch(hit.row, hit.cell);
      return true;
    }
    case 'add-field': {
      const row = model.rows.find((r) => r.id === op.row && r.kind === 'item');
      if (!row) return false;
      while (row.cells.length <= op.c) {
        row.cells.push({
          inline: false, html: '', fields: [], dirty: true,
        });
      }
      const cell = row.cells[op.c];
      const field = {
        type: op.type, inline: false, html: '', dirty: true, added: true, ...placeholderFor(op.type, op.sample, op.label),
      };
      cell.fields.splice(Math.min(op.at, cell.fields.length), 0, field);
      renumber(row);
      touch(row, cell);
      return true;
    }
    case 'remove-field': {
      const hit = findField(model, op.id);
      if (!hit) return false;
      hit.cell.fields.splice(hit.f, 1);
      renumber(hit.row);
      touch(hit.row, hit.cell);
      return true;
    }
    case 'add-item': {
      const src = model.rows.find((r) => r.id === op.from && r.kind === 'item');
      if (!src) return false;
      const labels = src.cells.map((cell) => labelFields(cell.fields, doc));
      const row = op.blank ? blankCopy(src, labels) : clone(src);
      row.id = op.id;
      row.dirty = true;
      row.added = true;
      renumber(row);
      insertAfterItem(model, row, op.after);
      return true;
    }
    case 'delete-item': {
      const at = model.rows.findIndex((r) => r.id === op.row && r.kind === 'item');
      if (at < 0 || items(model).length < 2) return false;
      model.rows.splice(at, 1);
      return true;
    }
    case 'move-item': {
      const list = items(model);
      const i = list.findIndex((r) => r.id === op.row);
      const j = i + op.by;
      if (i < 0 || j < 0 || j >= list.length) return false;
      const a = model.rows.indexOf(list[i]);
      const b = model.rows.indexOf(list[j]);
      [model.rows[a], model.rows[b]] = [model.rows[b], model.rows[a]];
      return true;
    }
    case 'variants':
      model.variants = [...new Set(op.list.map(toClass).filter(Boolean))];
      return true;
    case 'option': {
      const key = optionKey(op.key);
      const image = op.image ? { image: true, alt: op.image.alt || '', valueHtml: '' } : {};
      const value = op.image ? op.image.src || '' : norm(op.value);
      const row = options(model).find((r) => r.option.key === key);
      if (row) {
        Object.assign(row.option, image, { value });
        row.dirty = true;
        return true;
      }
      model.seq += 1;
      model.rows.push({
        id: `o${model.seq}-${key}`,
        kind: 'option',
        html: '',
        dirty: true,
        option: {
          key,
          keyText: op.keyText || key,
          keyHtml: escapeHtml(op.keyText || key),
          value,
          valueWrap: false,
          ...image,
        },
      });
      return true;
    }
    case 'remove-option': {
      const at = model.rows.findIndex((r) => r.kind === 'option' && r.option.key === optionKey(op.key));
      if (at < 0) return false;
      model.rows.splice(at, 1);
      return true;
    }
    default:
      return false;
  }
}

export function applyOps(model, ops, doc) {
  ops.forEach((op) => applyOp(model, op, doc));
  return model;
}

/** Adds an edit to a pending list, merging repeated edits of the same field. */
export function pushOp(ops, op) {
  const last = ops[ops.length - 1];
  if (op.t === 'set' && last?.t === 'set' && last.id === op.id) {
    last.props = { ...last.props, ...op.props };
    return ops;
  }
  if (op.t === 'variants' && last?.t === 'variants') {
    last.list = op.list;
    return ops;
  }
  ops.push(op);
  return ops;
}

/* Writing */

function unwrapP(html) {
  const match = html.match(/^<p>([\s\S]*)<\/p>$/);
  return match && !match[1].includes('<p>') ? match[1] : html;
}

function imageHtml(field, inline, doc) {
  if (!field.src) return '';
  const wrap = doc.createElement('div');
  wrap.innerHTML = field.html || '';
  let img = wrap.querySelector('img');
  if (!img) {
    wrap.innerHTML = inline ? '<picture><img></picture>' : '<p><picture><img></picture></p>';
    img = wrap.querySelector('img');
  }
  if (img.getAttribute('src') !== field.src) {
    img.setAttribute('src', field.src);
    ['srcset', 'sizes', 'width', 'height'].forEach((attr) => img.removeAttribute(attr));
    img.closest('picture')?.querySelectorAll('source').forEach((source) => {
      source.setAttribute('srcset', field.src);
      source.removeAttribute('sizes');
      source.removeAttribute('type');
    });
  }
  img.setAttribute('alt', field.alt || '');
  return wrap.innerHTML;
}

function buttonHtml(field, inline) {
  const text = norm(field.text);
  if (!text && !field.href) return '';
  const title = field.title ? ` title="${escapeHtml(field.title)}"` : '';
  let html = `<a href="${escapeHtml(field.href || '')}"${title}>${escapeHtml(text)}</a>`;
  if (field.style === 'primary') html = `<strong>${html}</strong>`;
  else if (field.style === 'secondary') html = `<em>${html}</em>`;
  else if (field.style === 'accent') html = `<strong><em>${html}</em></strong>`;
  return inline ? html : `<p>${html}</p>`;
}

export function fieldHtml(field, inline, doc) {
  if (!field.dirty && !!field.inline === inline) return field.html;
  switch (field.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(field.level) || 2));
      return field.value || !field.added ? `<h${level}>${field.value}</h${level}>` : '';
    }
    case 'text': {
      if (!textOf(field.value, doc) && field.added) return '';
      return inline ? unwrapP(field.value) : field.value;
    }
    case 'image': return imageHtml(field, inline, doc);
    case 'button': return buttonHtml(field, inline);
    case 'icon': {
      if (!field.name) return '';
      const html = field.format === 'span' ? `<span class="icon icon-${escapeHtml(field.name)}"></span>` : `:${field.name}:`;
      return inline ? html : `<p>${html}</p>`;
    }
    default:
      return !inline && field.inline ? `<p>${field.html}</p>` : field.html;
  }
}

function cellHtml(cell, doc) {
  if (!cell.dirty) return cell.html;
  const inline = cell.inline && cell.fields.length === 1;
  return cell.fields.map((field) => fieldHtml(field, inline, doc)).join('');
}

function rowHtml(row, doc) {
  if (!row.dirty) return row.html;
  if (row.kind === 'option') {
    const {
      keyHtml, value, valueWrap, image, alt, valueHtml,
    } = row.option;
    if (image) {
      const html = imageHtml({ src: value, alt, html: valueHtml }, !valueWrap, doc);
      return `<div><div>${keyHtml}</div><div>${html}</div></div>`;
    }
    return `<div><div>${keyHtml}</div><div>${valueWrap ? `<p>${escapeHtml(value)}</p>` : escapeHtml(value)}</div></div>`;
  }
  const cells = row.cells.map((cell) => cellHtml(cell, doc));
  while (cells.length > (row.cellCount || 1) && !cells[cells.length - 1]) cells.pop();
  return `<div>${cells.map((html) => `<div>${html}</div>`).join('')}</div>`;
}

/** Writes the model back as block HTML: `<div class="name variant">rows</div>`. */
export function buildBlock(model, doc) {
  const classes = [toClass(model.name) || model.name, ...model.variants].join(' ');
  return `<div class="${escapeHtml(classes)}">${model.rows.map((row) => rowHtml(row, doc)).join('')}</div>`;
}
