/**
 * Request plumbing for the ReviewLoop worker: CORS, JSON, input checks and the IMS check
 * that only lets people who can read the page in Document Authoring use Jira through it.
 */

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
export const IMS_PROFILE = 'https://ims-na1.adobelogin.com/ims/profile/v1';
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const PATH = /^(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$|^\/$/;
const AUTH_TTL = 5 * 60 * 1000;
const RATE_LIMIT = 60;
const MAX_BODY = 200 * 1024;

export const DEFAULT_ORIGINS = [
  'https://da.live',
  'https://*.da.live',
  'https://*.aem.page',
  'https://*.aem.live',
  'http://localhost:3000',
];

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function list(value) {
  return String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function wildcard(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9.-]+');
  return new RegExp(`^${escaped}$`, 'i');
}

export function allowedOrigin(origin, env = {}) {
  if (!origin) return null;
  const patterns = env.ALLOWED_ORIGINS ? list(env.ALLOWED_ORIGINS) : DEFAULT_ORIGINS;
  return patterns.some((p) => wildcard(p).test(origin)) ? origin : null;
}

export function corsHeaders(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

export async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new HttpError(415, 'Send the request as JSON.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'The request is too large.');
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Reported below.
  }
  throw new HttpError(400, 'The request is not valid JSON.');
}

/** The DA document path: "/" is "/index", ".html" is dropped. */
export function docPath(path) {
  const clean = String(path || '/').replace(/\.html$/, '');
  return clean.endsWith('/') ? `${clean}index` : clean;
}

/** The public path: "/index" is "/", "/x/index" is "/x/". */
export function webPath(path) {
  return docPath(path).replace(/(^|\/)index$/, '$1');
}

export function validatePage({ org, site, path } = {}) {
  if (!NAME.test(org || '') || !NAME.test(site || '') || !PATH.test(path || '')) {
    throw new HttpError(400, 'The request is missing a valid org, site and page path.');
  }
  if (path.split('/').some((part) => part === '..' || part === '.')) {
    throw new HttpError(400, 'The page path is not valid.');
  }
  return { org: org.toLowerCase(), site: site.toLowerCase(), path: docPath(path) };
}

/** Where the page lives: preview, live and the Experience Workspace editor. */
export function pageUrls({ org, site, path }) {
  const web = webPath(path);
  return {
    previewUrl: `https://main--${site}--${org}.aem.page${web}`,
    liveUrl: `https://main--${site}--${org}.aem.live${web}`,
    editUrl: `https://da.live/canvas#/${org}/${site}${docPath(path)}`,
  };
}

export function checkOrg({ org, site }, env) {
  const allowed = list(env.ALLOWED_ORGS);
  if (!allowed.length) {
    throw new HttpError(500, 'The worker is not set up yet: set ALLOWED_ORGS (for example "my-org" or "my-org/my-site").', { setup: true });
  }
  if (!allowed.includes(org) && !allowed.includes(`${org}/${site}`)) {
    throw new HttpError(403, `This worker does not review pages from ${org}/${site}. Add it to ALLOWED_ORGS.`);
  }
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const authCache = new Map();
const userCache = new Map();
const rates = new Map();

export function resetState() {
  authCache.clear();
  userCache.clear();
  rates.clear();
}

function remember(map, key, value) {
  map.set(key, value);
  if (map.size > 1000) map.delete(map.keys().next().value);
}

function rateLimit(key, now) {
  const entry = rates.get(key);
  if (!entry || entry.reset < now) {
    remember(rates, key, { count: 1, reset: now + 60000 });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) throw new HttpError(429, 'Too many requests. Try again in a minute.');
}

/**
 * Confirms the caller's Adobe IMS token can read the page through the DA source API (or the
 * newer AEM source API). Cached for five minutes per token and page.
 */
export async function authorize(request, page, env, now = Date.now()) {
  const header = request.headers.get('Authorization') || '';
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to Experience Workspace and try again.');
  checkOrg(page, env);
  const tokenKey = await sha256(token);
  rateLimit(tokenKey, now);
  const key = `${tokenKey}|${page.org}/${page.site}${page.path}`;
  if (authCache.get(key) > now) return { token, tokenKey };
  const doc = `${page.path}.html`;
  const urls = [
    `${DA_ADMIN}/source/${page.org}/${page.site}${doc}`,
    `${AEM_API}/${page.org}/sites/${page.site}/source${doc}`,
  ];
  let resp;
  try {
    for (let i = 0; i < urls.length && (!resp || resp.status === 404); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      resp = await fetch(urls[i], { method: 'HEAD', headers: { Authorization: `Bearer ${token}` } });
    }
  } catch {
    throw new HttpError(502, 'Could not reach Document Authoring to check your access.');
  }
  if (resp.status === 401) throw new HttpError(401, 'Your session expired. Reload Experience Workspace and try again.');
  if (resp.status === 403) throw new HttpError(403, 'You do not have access to this page.');
  if (resp.status === 404) throw new HttpError(404, 'This page was not found in Document Authoring.');
  if (!resp.ok) throw new HttpError(502, `Document Authoring answered ${resp.status}.`);
  remember(authCache, key, now + AUTH_TTL);
  return { token, tokenKey };
}

/** The author's name from their Adobe profile, so Jira and the panel say who did what. */
export async function imsUser({ token, tokenKey }, now = Date.now()) {
  const cached = userCache.get(tokenKey);
  if (cached && cached.until > now) return cached.name;
  let name = '';
  try {
    const resp = await fetch(IMS_PROFILE, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.ok) {
      const p = await resp.json();
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ');
      name = String(p.displayName || p.name || full || '').slice(0, 100);
    }
  } catch {
    // The name is a nicety; carry on without it.
  }
  remember(userCache, tokenKey, { name, until: now + AUTH_TTL });
  return name;
}
