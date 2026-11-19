/**
 * Request plumbing for the Figma worker: CORS, JSON, input checks, the IMS check that only
 * lets people who can read the site in Document Authoring open its handoffs, and the team
 * key check for the Figma plugin.
 */

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const PATH = /^(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$|^\/$/;
const AUTH_TTL = 5 * 60 * 1000;
const RATE_LIMIT = 60;
export const MAX_BODY = 64 * 1024;

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

/** `origin` is an allowed origin, or '*' for the Figma plugin (its iframe has no origin). */
export function corsHeaders(origin) {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    ...(origin === '*' ? {} : { Vary: 'Origin' }),
  };
}

export function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

export async function readBody(request, max = MAX_BODY) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new HttpError(415, 'Send the request as JSON.');
  }
  if (Number(request.headers.get('Content-Length') || 0) > max) {
    throw new HttpError(413, 'The request is too large.');
  }
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, 'The request is too large.');
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

export function validateSite({ org, site } = {}) {
  if (!NAME.test(org || '') || !NAME.test(site || '')) {
    throw new HttpError(400, 'The request is missing a valid org and site.');
  }
  return { org: org.toLowerCase(), site: site.toLowerCase() };
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

export function checkOrg({ org, site }, env) {
  const allowed = list(env.ALLOWED_ORGS);
  if (!allowed.length) {
    throw new HttpError(500, 'The worker is not set up yet: set ALLOWED_ORGS (for example "my-org" or "my-org/my-site").', { setup: true });
  }
  if (!allowed.includes(org) && !allowed.includes(`${org}/${site}`)) {
    throw new HttpError(403, `This worker does not serve ${org}/${site}. Add it to ALLOWED_ORGS.`);
  }
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const authCache = new Map();
const rates = new Map();

export function resetState() {
  authCache.clear();
  rates.clear();
}

function remember(map, key, value) {
  map.set(key, value);
  if (map.size > 1000) map.delete(map.keys().next().value);
}

export function rateLimit(key, now) {
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

/** The Figma plugin's team key (HANDOFF_KEY), compared by hash so timing says nothing. */
export async function checkKey(request, site, env, now = Date.now()) {
  if (!env.HANDOFF_KEY) {
    throw new HttpError(500, 'The worker is not set up yet: add the HANDOFF_KEY secret.', { setup: true });
  }
  const header = request.headers.get('Authorization') || '';
  const key = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) throw new HttpError(401, 'Add the team key in the plugin settings.');
  const given = await sha256(key);
  rateLimit(`key|${given}`, now);
  if (given !== await sha256(env.HANDOFF_KEY)) throw new HttpError(401, 'That team key is not right. Ask whoever set up the worker.');
  checkOrg(site, env);
}
