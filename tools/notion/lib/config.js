/**
 * Site settings from the DA config (da.live/config#/{org}/{site}):
 *
 *   notion           key | value: worker-url, image-folder, new-page-folder, path-property,
 *                    description-property, keywords-property, allow-browse
 *   notion-sources   title | database | status
 *
 * Any setting can also be given in the plugin URL, e.g. notion.html?worker-url=https://…
 */

import { cleanPath } from './convert.js';

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
export const SETTINGS = [
  'worker-url', 'image-folder', 'new-page-folder', 'path-property', 'description-property',
  'keywords-property', 'allow-browse',
];

export const DEFAULTS = {
  'image-folder': '/media/notion',
  'new-page-folder': '/drafts',
  'path-property': 'Page path',
  'description-property': 'Description',
  'keywords-property': 'Keywords',
  'allow-browse': 'yes',
};

const ID = /[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i;

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

/** A database id from an id or a Notion link ('' when there is none). */
export function databaseId(value) {
  const text = String(value || '').split(/[?#]/)[0];
  const all = text.match(new RegExp(ID.source, 'gi'));
  return all ? all[all.length - 1].replace(/-/g, '').toLowerCase() : '';
}

export function parseSettings(json, search = '') {
  const out = { ...DEFAULTS };
  sheet(json, 'notion').forEach((row) => {
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
  out['new-page-folder'] = cleanPath(out['new-page-folder']) || '';
  return out;
}

/** Named databases authors pick from, optionally only entries with some statuses. */
export function parseSources(json) {
  return sheet(json, 'notion-sources').map((row) => ({
    title: pick(row, 'title'),
    database: databaseId(pick(row, 'database')),
    status: pick(row, 'status').split(',').map((s) => s.trim()).filter(Boolean),
  })).filter((s) => s.title && s.database);
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
