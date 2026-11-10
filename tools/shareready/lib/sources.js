import { toMetaName } from './extract.js';
import {
  DA_ADMIN, AEM_API, sourceUrls, fetchFirst,
} from './aem.js';

export { DA_ADMIN };
const DA_CONTENT = 'content.da.live';

/** Config keys read from the `shareready` sheet (or the plugin URL's query string). */
export const CONFIG_KEYS = [
  'host', 'brand', 'x-handle', 'query-index', 'worker-url', 'slack-channel',
  'utm-source', 'utm-medium', 'utm-campaign',
];

function firstSheet(json) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json[':names'])) return json[json[':names'][0]]?.data || null;
  return null;
}

function sheet(json, name) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json[name])) return json[name];
  if (Array.isArray(json[name]?.data)) return json[name].data;
  if (json[':sheetname'] === name || json[':name'] === name) return firstSheet(json);
  return null;
}

function pick(row, ...names) {
  const key = Object.keys(row).find((k) => names.includes(k.trim().toLowerCase()));
  return key === undefined ? undefined : row[key];
}

/** Reads key/value rows from the `shareready` sheet of a DA site config. */
export function parseConfig(json) {
  const rows = sheet(json, 'shareready') || [];
  return rows.reduce((acc, row) => {
    const key = String(pick(row, 'key') || '').trim().toLowerCase();
    const value = String(pick(row, 'value') ?? '').trim();
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

/** Config overrides from the plugin URL, e.g. shareready.html?host=www.example.com */
export function configFromQuery(search) {
  const params = new URLSearchParams(search);
  return CONFIG_KEYS.reduce((acc, key) => {
    if (params.get(key)) acc[key] = params.get(key);
    return acc;
  }, {});
}

function globToRegExp(glob) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const pattern = glob.trim().split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${pattern}$`);
}

/**
 * Bulk metadata (metadata.json) values that apply to a path. Later rows win.
 */
export function bulkFor(path, json) {
  const rows = firstSheet(json) || [];
  const out = {};
  rows.forEach((row) => {
    const url = pick(row, 'url', 'source');
    if (!url || !globToRegExp(String(url)).test(path)) return;
    Object.entries(row).forEach(([column, value]) => {
      const name = toMetaName(column);
      if (name === 'url' || name === 'source' || value === undefined || value === '') return;
      out[name] = String(value);
    });
  });
  return out;
}

/**
 * content.da.live URLs are private for protected sites; the source API serves them
 * with a token.
 */
export function toAdminUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== DA_CONTENT) return null;
    return `${DA_ADMIN}/source${u.pathname}`;
  } catch {
    return null;
  }
}

export function siteOrigins({ org, repo, branch = 'main' }) {
  const ref = (branch || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return {
    preview: `https://${ref}--${repo}--${org}.aem.page`,
    live: `https://main--${repo}--${org}.aem.live`,
  };
}

export function createFetcher(initialToken) {
  let token = initialToken;
  return {
    setToken(next) { if (next) token = next; },
    get token() { return token; },
    async auth(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetch(url, { ...opts, headers });
    },
  };
}

export async function fetchSource(fetcher, context) {
  const resp = await fetchFirst(fetcher, sourceUrls(context));
  if (!resp?.ok) {
    const error = new Error(`Could not read the page (${resp.status})`);
    error.status = resp.status;
    throw error;
  }
  return resp.text();
}

async function readJson(promise) {
  try {
    const resp = await promise;
    return resp.ok ? await resp.json() : null;
  } catch {
    return null;
  }
}

/** Site config: DA's config store, or the site config of the newer AEM API. */
export async function loadConfig(fetcher, { org, repo }) {
  const data = await readJson(fetcher.auth(`${DA_ADMIN}/config/${org}/${repo}/`))
    || await readJson(fetcher.auth(`${AEM_API}/${org}/sites/${repo}/config/editor/da.json`));
  return parseConfig(data);
}

export async function loadBulk(fetcher, { org, repo }) {
  return readJson(fetchFirst(fetcher, [
    `${DA_ADMIN}/source/${org}/${repo}/metadata.json`,
    `${AEM_API}/${org}/sites/${repo}/source/metadata.json`,
  ]));
}

/** query-index.json is public but has no CORS headers unless the site adds them. */
export async function loadIndex(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { index: null, error: `HTTP ${resp.status}` };
    return { index: await resp.json(), error: null };
  } catch {
    return { index: null, error: 'blocked' };
  }
}

/**
 * Finds the site's query index: on the plugin's own origin first (when ShareReady is served
 * from the site), then on the live site. Returns { index, error: { url, error } | null }.
 */
export async function findSiteIndex(context, config = {}, here = window.location) {
  const { org, repo } = context;
  const indexPath = config['query-index'] || '/query-index.json';
  const sameSite = here.hostname.includes(`--${repo}--${org}.`) || here.hostname === 'localhost';
  const urls = [
    sameSite ? new URL(indexPath, here.origin).href : null,
    new URL(indexPath, siteOrigins(context).live).href,
  ].filter(Boolean);
  let last = {};
  for (let i = 0; i < urls.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await loadIndex(urls[i]);
    if (last.index) break;
  }
  return {
    index: last.index,
    error: last.index ? null : { url: urls[urls.length - 1], error: last.error },
  };
}

function probe(src, timeout) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeout);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

async function loadViaAdmin(admin, fetcher, timeout) {
  try {
    const resp = await fetcher.auth(admin);
    if (!resp.ok) return { ok: false };
    const display = URL.createObjectURL(await resp.blob());
    const size = await probe(display, timeout);
    return size ? { ok: true, ...size, display } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Loads an image to learn its size. Returns { ok, width, height, display }, where display
 * is a URL the panel can show (a blob URL when the image needed the author's token).
 */
export async function loadImageInfo(url, fetcher, timeout = 8000) {
  if (!url) return { ok: false };
  const admin = toAdminUrl(url);
  // Protected sites answer content.da.live with a 401, so ask the source API first.
  if (admin && fetcher?.token) {
    const info = await loadViaAdmin(admin, fetcher, timeout);
    if (info.ok) return info;
  }
  const direct = await probe(url, timeout);
  return direct ? { ok: true, ...direct, display: url } : { ok: false };
}
