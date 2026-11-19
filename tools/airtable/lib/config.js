/**
 * Site settings from the DA config (da.live/config#/{org}/{site}):
 *
 *   airtable           key | value: worker-url, locale, time-zone, link-text, image-folder,
 *                      max-records, allow-browse
 *   airtable-sources   title | base | table | view | fields | format | block | labels | header
 *
 * Any setting can also be given in the plugin URL, e.g. airtable.html?worker-url=https://…
 */

import { BASE_ID } from './airtable.js';
import { FORMATS } from './format.js';

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
export const SETTINGS = [
  'worker-url', 'locale', 'time-zone', 'link-text', 'image-folder', 'max-records', 'allow-browse',
];

export const DEFAULTS = {
  locale: 'en-us',
  'link-text': 'Learn more',
  'image-folder': '/media/airtable',
  'max-records': '300',
  'allow-browse': 'yes',
};

function sheet(json, name) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json[name])) return json[name];
  if (Array.isArray(json[name]?.data)) return json[name].data;
  return [];
}

function pick(row, name) {
  const key = Object.keys(row || {}).find((k) => k.trim().toLowerCase() === name);
  return key === undefined ? '' : String(row[key] ?? '').trim();
}

const yes = (value, fallback) => (value ? /^(y|yes|true|on|1)$/i.test(value) : fallback);

export function parseSettings(json, search = '') {
  const out = { ...DEFAULTS };
  sheet(json, 'airtable').forEach((row) => {
    const key = pick(row, 'key').toLowerCase();
    const value = pick(row, 'value');
    if (SETTINGS.includes(key) && value) out[key] = value;
  });
  const params = new URLSearchParams(search);
  SETTINGS.forEach((key) => {
    if (params.get(key)) out[key] = params.get(key);
  });
  const worker = out['worker-url'];
  if (worker && /^(https:\/\/|http:\/\/localhost(:\d+)?(\/|$))/.test(worker)) {
    out['worker-url'] = worker.replace(/\/+$/, '');
  } else delete out['worker-url'];
  return out;
}

/** Named sources authors pick from, so nobody needs to know base or table ids. */
export function parseSources(json) {
  return sheet(json, 'airtable-sources').map((row) => {
    const format = pick(row, 'format').toLowerCase();
    return {
      title: pick(row, 'title'),
      base: pick(row, 'base'),
      table: pick(row, 'table'),
      view: pick(row, 'view'),
      fields: pick(row, 'fields').split(',').map((f) => f.trim()).filter(Boolean),
      format: FORMATS[format] ? format : '',
      block: pick(row, 'block'),
      labels: yes(pick(row, 'labels'), undefined),
      header: yes(pick(row, 'header'), undefined),
    };
  }).filter((s) => s.title && BASE_ID.test(s.base) && s.table);
}

export async function loadSiteConfig(token, { org, repo }, fetchImpl = fetch) {
  const urls = [
    `${DA_ADMIN}/config/${org}/${repo}/`,
    `${AEM_API}/${org}/sites/${repo}/config/editor/da.json`,
  ];
  for (let i = 0; i < urls.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetchImpl(urls[i], { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      // eslint-disable-next-line no-await-in-loop
      if (resp.ok) return await resp.json();
    } catch {
      // Try the next one.
    }
  }
  return null;
}
