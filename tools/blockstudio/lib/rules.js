/**
 * Site configuration Block Studio reads. Everything is optional:
 *  - the `block-studio` sheet in the site config: labels, limits, required fields,
 *    hints, option values and overrides, per block;
 *  - the "Blocks" library row (the same one Block Inspector uses): its `options`
 *    sheet gives dropdown values and its block pages give variant suggestions.
 */

import { optionKey, toClass } from './model.js';
import { parseHtml, blockElements, classesOf } from './live.js';

export const DA_ADMIN = 'https://admin.da.live';
const DA_HOSTS = /^https:\/\/(admin|content)\.da\.live\//;

/** fetch() that sends the IMS token to da.live only, never to other hosts. */
export function makeFetcher(getToken, fetchImpl = fetch) {
  return (url, opts = {}) => {
    const token = getToken?.();
    const headers = { ...(opts.headers || {}) };
    if (token && DA_HOSTS.test(url)) headers.Authorization = `Bearer ${token}`;
    return fetchImpl(url, { ...opts, headers });
  };
}

/** Rows of one sheet from a DA sheet or multi-sheet JSON. */
export function sheetRows(json, name) {
  if (!json) return [];
  if (json[name]?.data) return json[name].data;
  if (Array.isArray(json.data) && (json[':sheetname'] === name || (!name && !json[':names']))) return json.data;
  return [];
}

const truthy = (value) => /^(yes|y|true|1|x|required)$/i.test(String(value ?? '').trim());
const blockKey = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  return key === '*' || key === 'all' || !key ? 'all' : toClass(key);
};
const lower = (row) => Object.fromEntries(Object.entries(row || {})
  .map(([key, value]) => [key.toLowerCase().trim(), typeof value === 'string' ? value.trim() : value]));

/** `Label=value|Label 2=value-2` (or a comma list) to [{title, value}]. */
export function parseValues(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const parts = raw.includes('|') ? raw.split('|') : raw.split(',');
  return parts.map((entry) => {
    const at = entry.indexOf('=');
    const title = (at >= 0 ? entry.slice(0, at) : entry).trim();
    const value = (at >= 0 ? entry.slice(at + 1) : entry).trim();
    return { title, value: value || title };
  }).filter((entry) => entry.title);
}

const titleCase = (text) => String(text || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const list = (text) => String(text ?? '').split(',').map((part) => part.trim()).filter(Boolean);

/** Reads the `block-studio` sheet rows. */
export function parseRules(rows) {
  return (rows || []).map(lower).filter((row) => row.field).map((row) => ({
    block: blockKey(row.block),
    field: toClass(row.field),
    label: row.label || '',
    max: Number.parseInt(row.max, 10) || 0,
    required: truthy(row.required),
    hint: row.hint || '',
    values: row.values || '',
  }));
}

/**
 * The rules that apply to one block, with block rows overriding `all` rows.
 * `schema` adds the block library's typed options (`optionDefs`) and the `fields`
 * sheet (`itemFields`), so a new block is configured without changing Block Studio.
 */
export function blockRules(rules, name, libraryOptions, schema = {}) {
  const key = toClass(name);
  const fields = new Map();
  const result = {
    fields, options: null, items: null, variants: [], noun: '', icons: [], values: new Map(),
  };
  const merge = (row) => {
    if (row.field === 'options') result.options = list(row.values).map(optionKey);
    else if (row.field === 'items') {
      result.items = /^all$/i.test(row.values) ? 'all' : list(row.values).map(optionKey);
      if (row.label) result.noun = row.label;
    } else if (row.field === 'variants') result.variants = list(row.values).map(toClass);
    else if (row.field === 'icons') result.icons = list(row.values).map(toClass);
    else {
      const set = Object.fromEntries(Object.entries(row).filter(([, v]) => v));
      fields.set(row.field, { ...(fields.get(row.field) || {}), ...set });
      if (row.values) result.values.set(row.field, parseValues(row.values));
    }
  };
  (rules || []).filter((row) => row.block === 'all').forEach(merge);
  (rules || []).filter((row) => row.block === key).forEach(merge);
  const library = libraryOptions?.get?.(key) || libraryOptions?.get?.('all');
  library?.forEach((values, optKey) => {
    if (!result.values.has(optKey)) result.values.set(optKey, values);
  });
  const defs = schema?.optionDefs?.get?.(key) || schema?.optionDefs?.get?.('all') || new Map();
  result.optionDefs = defs;
  defs.forEach((def, optKey) => {
    if (!result.values.has(optKey)) result.values.set(optKey, def.values);
  });
  result.imageKeys = new Set([...defs.values()].filter((def) => def.type === 'image').map((def) => def.key));
  result.itemFields = schema?.itemFields?.get?.(key) || [];
  result.itemFields.forEach((def) => {
    const slug = toClass(def.label);
    const set = Object.fromEntries(Object.entries({
      label: def.label, required: def.required, max: def.max, hint: def.hint,
    }).filter(([, v]) => v));
    // The rules sheet's row for the field wins, then this sheet, then the rule for its type.
    fields.set(slug, { ...(fields.get(def.type) || {}), ...set, ...(fields.get(slug) || {}) });
  });
  result.knownKeys = new Set([...result.values.keys(), ...(result.options || [])]);
  return result;
}

/** The rule for a field, by its label ("primary-button"), its base label, then its type. */
export function fieldRule(rules, label, type) {
  if (!rules) return {};
  const slug = toClass(label);
  return rules.fields.get(slug) || rules.fields.get(slug.replace(/-\d+$/, ''))
    || rules.fields.get(type) || {};
}

export const OPTION_TYPES = ['select', 'text', 'image', 'toggle'];
export const FIELD_TYPES = ['image', 'text', 'heading', 'button', 'icon'];

const optionValues = (text) => parseValues(String(text ?? '').includes('|') || !String(text ?? '').includes(',')
  ? text : String(text).replaceAll(',', '|'));

/** Groups rows by the blocks they name; `all` entries fill in every other block. */
function byBlock(rows, read) {
  const map = new Map();
  (rows || []).map(lower).forEach((row) => {
    const entry = read(row);
    if (!entry) return;
    list(row.blocks).forEach((name) => {
      const key = blockKey(name);
      if (!map.has(key)) map.set(key, new Map());
      map.get(key).set(entry[0], entry[1]);
    });
  });
  const all = map.get('all');
  if (all) {
    map.forEach((opts, name) => {
      if (name === 'all') return;
      all.forEach((value, key) => { if (!opts.has(key)) opts.set(key, value); });
    });
  }
  return map;
}

/**
 * Block Inspector's `options` sheet: blocks | key | values → Map(block → Map(key → values)).
 * Rows with a `type` but no values (text, image, toggle) are kept with no values.
 */
export function parseLibraryOptions(rows) {
  return byBlock(rows, (row) => {
    const typed = OPTION_TYPES.includes(String(row.type || '').toLowerCase());
    if (!row.blocks || !row.key || (!row.values && !typed)) return null;
    return [optionKey(row.key), optionValues(row.values)];
  });
}

/**
 * Typed options from the same sheet, with Block Studio's extra columns (EW ignores them):
 * blocks | key | values | label | type | default → Map(block → Map(key → definition)).
 * Every definition is shown as a control, in sheet order.
 */
export function parseOptionDefs(rows) {
  return byBlock(rows, (row) => {
    if (!row.blocks || !row.key) return null;
    const values = optionValues(row.values);
    let type = String(row.type || '').toLowerCase();
    if (!OPTION_TYPES.includes(type)) type = values.length ? 'select' : '';
    if (!type) return null;
    const key = optionKey(row.key);
    return [key, {
      key,
      keyText: String(row.key).trim().toLowerCase(),
      label: row.label || '',
      type,
      default: String(row.default ?? '').trim(),
      values,
    }];
  });
}

/**
 * The `fields` sheet: block | column | name | type | label | required | max | hint.
 * Describes the cells of each item of a repeating block (a card, a slide), so missing
 * fields can be added and named. → Map(block → [{c, name, type, label, …}]).
 */
export function parseItemFields(rows) {
  const map = new Map();
  (rows || []).map(lower).forEach((row) => {
    const type = String(row.type || '').toLowerCase();
    const column = Number.parseInt(row.column, 10);
    const name = row.block || row.blocks;
    if (!name || !FIELD_TYPES.includes(type) || !(column >= 1)) return;
    const label = row.label || titleCase(row.name || type);
    list(name).forEach((blockName) => {
      const key = blockKey(blockName);
      if (key === 'all') return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        c: column - 1,
        name: toClass(row.name || label),
        type,
        label,
        required: truthy(row.required),
        max: Number.parseInt(row.max, 10) || 0,
        hint: row.hint || '',
      });
    });
  });
  return map;
}

/** The "Blocks" row of the `library` sheet, resolved to absolute index URLs. */
export function blocksLibraryUrls(libraryRows, { org, site, ref = 'main' }) {
  const row = (libraryRows || []).map(lower).find((entry) => entry.title?.toLowerCase() === 'blocks'
    && (!entry.ref || entry.ref === 'main' || entry.ref === ref));
  if (!row?.path) return [];
  const branch = ref === 'local' ? 'main' : ref;
  return list(row.path).map((path) => (path.startsWith('/')
    ? `https://${branch}--${site}--${org}.aem.live${path}` : path));
}

function firstSheet(json) {
  if (Array.isArray(json?.data)) return json.data;
  const name = json?.[':names']?.find((n) => !['options', 'editor', 'fields'].includes(n)) || json?.[':names']?.[0];
  return json?.[name]?.data || [];
}

async function getJson(fetcher, url) {
  try {
    const resp = await fetcher(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Loads the site's config. Missing sheets and network errors return empty settings,
 * so the panel always works with zero setup. The library index is read with the
 * same fetcher, so a DA-hosted library (content.da.live) gets the IMS token.
 */
export async function loadSiteSettings(fetcher, context, fetchImpl = fetcher) {
  const { org, site } = context;
  const [siteJson, orgJson] = await Promise.all([
    getJson(fetcher, `${DA_ADMIN}/config/${org}/${site}`),
    getJson(fetcher, `${DA_ADMIN}/config/${org}`),
  ]);
  const rules = [...sheetRows(orgJson, 'block-studio'), ...sheetRows(siteJson, 'block-studio')];
  const library = [...sheetRows(siteJson, 'library'), ...sheetRows(orgJson, 'library')];
  const indexUrls = blocksLibraryUrls(library, context);
  const indexes = (await Promise.all(indexUrls.map((url) => getJson(fetchImpl, url))))
    .filter(Boolean);
  const optionRows = indexes.flatMap((json) => json.options?.data || []);
  return {
    rules: parseRules(rules),
    libraryOptions: parseLibraryOptions(optionRows),
    optionDefs: parseOptionDefs(optionRows),
    itemFields: parseItemFields(indexes.flatMap((json) => json.fields?.data || [])),
    libraryBlocks: indexes.flatMap(firstSheet).map(lower).filter((row) => row.name && row.path),
    loaded: !!siteJson,
  };
}

const isHeading = (el) => /^H[1-6]$/.test(el?.tagName || '');

/** The `library-metadata` block after an example: key | value rows. */
function exampleMeta(el) {
  let next = el.nextElementSibling;
  while (next && next.tagName !== 'DIV') next = next.nextElementSibling;
  if (!next || !classesOf(next).includes('library-metadata')) return {};
  return Object.fromEntries([...next.children].map((row) => [
    String(row.children[0]?.textContent || '').trim().toLowerCase(),
    String(row.children[1]?.textContent || '').trim(),
  ]));
}

/**
 * The variants the block library documents for a block, as [{value, title, description}].
 * Each example's class tokens are variants; its heading and `library-metadata`
 * description describe the variant when the example uses exactly one.
 */
export async function libraryVariants(libraryBlocks, name, fetchImpl = fetch, Parser = DOMParser) {
  const key = toClass(name);
  const entries = (libraryBlocks || []).filter((row) => toClass(row.name) === key
    || toClass(row.name).replace(/s$/, '') === key.replace(/s$/, ''));
  const found = new Map();
  await Promise.all(entries.map(async (entry) => {
    try {
      const url = /\.(aem|hlx)\.(page|live)\//.test(entry.path) ? `${entry.path.replace(/\.html$/, '')}.plain.html` : entry.path;
      const resp = await fetchImpl(url);
      if (!resp.ok) return;
      // aem.page returns bare sections; content.da.live returns a whole document.
      const text = await resp.text();
      const doc = parseHtml(/<main[\s>]/i.test(text) ? text : `<main>${text}</main>`, Parser);
      blockElements(doc).forEach((el) => {
        const [blockName, ...variants] = classesOf(el);
        if (blockName !== key) return;
        const prev = el.previousElementSibling;
        const meta = exampleMeta(el);
        variants.forEach((value) => {
          const own = variants.length === 1;
          const known = found.get(value);
          const heading = own && isHeading(prev) ? prev.textContent.trim() : '';
          found.set(value, {
            value,
            title: heading || known?.title || titleCase(value),
            description: (own && meta.description) || known?.description || '',
          });
        });
      });
    } catch {
      // A missing example page only means fewer suggestions.
    }
  }));
  return [...found.values()];
}
