/**
 * Site settings from the DA config (da.live/config#/{org}/{site}), sheet "__NAME__":
 *
 *   key | value
 *   worker-url     https URL of the worker (required for live data)
 *   block          optional block name to wrap inserted content in, e.g. "Cards"
 *   heading-level  2-6 (default 3)
 *   link-text      text of the inserted link (default "Read more")
 *
 * Any setting can also be given in the plugin URL, e.g. __NAME__.html?worker-url=https://…
 * With no config the panel shows a setup screen and a "Try with sample data" button.
 */

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
export const SHEET = '__NAME__';
export const SETTINGS = ['worker-url', 'block', 'heading-level', 'link-text'];

export const DEFAULTS = {
  block: '',
  'heading-level': '3',
  'link-text': 'Read more',
};

const BLOCK_NAME = /^[a-z][a-z0-9 ,()-]{0,60}$/i;

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

/** The DA document path: "/" is "/index", ".html" is dropped. */
export function docPath(path) {
  const clean = String(path || '/').replace(/\.html$/, '');
  return clean.endsWith('/') ? `${clean}index` : clean;
}

/** Defaults, then the site sheet, then URL params. Invalid values fall back to defaults. */
export function parseSettings(json, search = '') {
  const out = { ...DEFAULTS };
  sheet(json, SHEET).forEach((row) => {
    const key = pick(row, 'key').toLowerCase();
    const value = pick(row, 'value');
    if (SETTINGS.includes(key) && value) out[key] = value;
  });
  const params = new URLSearchParams(search);
  SETTINGS.forEach((key) => {
    if (params.get(key)) out[key] = params.get(key).trim();
  });
  const worker = out['worker-url'];
  if (worker && /^(https:\/\/|http:\/\/localhost(:\d+)?(\/|$))/.test(worker)) {
    out['worker-url'] = worker.replace(/\/+$/, '');
  } else delete out['worker-url'];
  if (!/^[2-6]$/.test(out['heading-level'])) out['heading-level'] = DEFAULTS['heading-level'];
  if (out.block && !BLOCK_NAME.test(out.block)) out.block = '';
  return out;
}

/** The multi-sheet site config, from DA or the newer AEM config API. null when unreadable. */
export async function loadSiteConfig(token, { org, repo }, fetchImpl = fetch) {
  const urls = [
    `${DA_ADMIN}/config/${org}/${repo}/`,
    `${AEM_API}/${org}/sites/${repo}/config/editor/da.json`,
  ];
  for (let i = 0; i < urls.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetchImpl(urls[i], {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      // eslint-disable-next-line no-await-in-loop
      if (resp.ok) return await resp.json();
    } catch {
      // Try the next one.
    }
  }
  return null;
}
