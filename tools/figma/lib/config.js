/**
 * Site settings from the DA config (da.live/config#/{org}/{site}):
 *
 *   figma   key | value: worker-url, image-folder, new-page-folder, blocks
 *
 * Any setting can also be given in the plugin URL, e.g. figma.html?worker-url=https://…
 */

import { cleanPath } from './convert.js';

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
export const SETTINGS = ['worker-url', 'image-folder', 'new-page-folder', 'blocks'];

export const DEFAULTS = {
  'image-folder': '/media/figma',
  'new-page-folder': '/drafts',
  blocks: 'Hero, Cards, Columns, Accordion, Table',
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

export function parseSettings(json, search = '') {
  const out = { ...DEFAULTS };
  sheet(json, 'figma').forEach((row) => {
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
  out.blocks = String(out.blocks).split(',').map((b) => b.trim()).filter(Boolean);
  return out;
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
