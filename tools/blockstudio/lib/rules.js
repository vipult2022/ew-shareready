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

/** The rules that apply to one block, with block rows overriding `all` rows. */
export function blockRules(rules, name, libraryOptions) {
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

/** Block Inspector's `options` sheet: blocks | key | values → Map(block → Map(key → values)). */
export function parseLibraryOptions(rows) {
  const map = new Map();
  (rows || []).map(lower).forEach((row) => {
    if (!row.blocks || !row.key || !row.values) return;
    const values = parseValues(row.values.includes('|') || !row.values.includes(',') ? row.values : row.values.replaceAll(',', '|'));
    list(row.blocks).forEach((name) => {
      const key = blockKey(name);
      if (!map.has(key)) map.set(key, new Map());
      map.get(key).set(optionKey(row.key), values);
    });
  });
  const all = map.get('all');
  if (all) {
    map.forEach((opts, name) => {
      if (name === 'all') return;
      all.forEach((values, key) => { if (!opts.has(key)) opts.set(key, values); });
    });
  }
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
  const name = json?.[':names']?.find((n) => !['options', 'editor'].includes(n)) || json?.[':names']?.[0];
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
 * so the panel always works with zero setup.
 */
export async function loadSiteSettings(fetcher, context, fetchImpl = fetch) {
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
  return {
    rules: parseRules(rules),
    libraryOptions: parseLibraryOptions(indexes.flatMap((json) => json.options?.data || [])),
    libraryBlocks: indexes.flatMap(firstSheet).map(lower).filter((row) => row.name && row.path),
    loaded: !!siteJson,
  };
}

/** Variants used by the block's examples in the block library (fetched once per block). */
export async function libraryVariants(libraryBlocks, name, fetchImpl = fetch, Parser = DOMParser) {
  const key = toClass(name);
  const entries = (libraryBlocks || []).filter((row) => toClass(row.name) === key
    || toClass(row.name).replace(/s$/, '') === key.replace(/s$/, ''));
  const found = new Set();
  await Promise.all(entries.map(async (entry) => {
    try {
      const url = /\.(aem|hlx)\.(page|live)\//.test(entry.path) ? `${entry.path.replace(/\.html$/, '')}.plain.html` : entry.path;
      const resp = await fetchImpl(url);
      if (!resp.ok) return;
      const doc = parseHtml(`<main>${await resp.text()}</main>`, Parser);
      blockElements(doc).forEach((el) => {
        const [blockName, ...variants] = classesOf(el);
        if (blockName === key) variants.forEach((v) => found.add(v));
      });
    } catch {
      // A missing example page only means fewer suggestions.
    }
  }));
  return [...found];
}
