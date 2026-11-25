/**
 * __TITLE__ worker: holds the service secret so it never reaches the browser. Every call
 * except /status needs the author's IMS token and only works for a page that token can read
 * in Document Authoring, on an org or site listed in ALLOWED_ORGS.
 *
 *   GET  /status  whether the worker is set up (no token needed)
 *   POST /items   items from the service, as { items: [{ id, title, summary, url }] }
 *
 * Every POST body carries { org, site, path } for the page open in Experience Workspace.
 * To add a route: add a function to `routes`, validate its input, map the service's
 * response to a small shape, and add tests in test/worker.test.js.
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, authorize, list,
} from './http.js';

const CACHE_TTL = 60000;
const MAX_ITEMS = 100;
const cache = new Map();

export function resetCache() {
  cache.clear();
}

async function memo(key, run, now) {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  const value = await run();
  cache.set(key, { value, until: now + CACHE_TTL });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

function serviceBase(env) {
  const base = String(env.SERVICE_URL || '').replace(/\/+$/, '');
  if (!env.SERVICE_TOKEN || !/^https:\/\//.test(base)) {
    throw new HttpError(500, 'The worker is not set up yet: set SERVICE_URL and add the SERVICE_TOKEN secret.', { setup: true });
  }
  return base;
}

/** One GET to the service with the team secret. Reads are retried once on a network error. */
async function serviceGet(env, path) {
  const url = `${serviceBase(env)}${path}`;
  const init = { headers: { Authorization: `Bearer ${env.SERVICE_TOKEN}`, Accept: 'application/json' } };
  let resp;
  try {
    resp = await fetch(url, init).catch(() => fetch(url, init));
  } catch {
    throw new HttpError(502, 'Could not reach the service.');
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new HttpError(502, 'The service rejected the worker’s credentials. Check the SERVICE_TOKEN secret.');
  }
  if (resp.status === 429) throw new HttpError(429, 'The service is busy. Try again in a minute.');
  if (!resp.ok) throw new HttpError(502, `The service answered ${resp.status}.`);
  return resp.json();
}

/** Maps the service's response to the panel's item shape. Change this for your service. */
export function toItems(data) {
  const rows = Array.isArray(data) ? data : data?.items || data?.results || [];
  return rows.map((row) => ({
    id: String(row?.id ?? ''),
    title: String(row?.title ?? row?.name ?? ''),
    summary: String(row?.summary ?? row?.description ?? ''),
    url: String(row?.url ?? ''),
  })).filter((item) => item.id && item.title).slice(0, MAX_ITEMS);
}

const routes = {
  async items(body, env, now) {
    const path = env.ITEMS_PATH || '/items';
    return memo(`items|${path}`, async () => ({ items: toItems(await serviceGet(env, path)) }), now);
  },
};

export async function handle(request, env = {}, now = Date.now()) {
  const origin = allowedOrigin(request.headers.get('Origin'), env);
  const route = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
  }
  try {
    if (request.method === 'GET' && route === 'status') {
      return json({
        ok: true,
        service: '__NAME__',
        configured: !!env.SERVICE_TOKEN && !!env.SERVICE_URL && list(env.ALLOWED_ORGS).length > 0,
      }, 200, origin);
    }
    if (request.method !== 'POST' || !Object.hasOwn(routes, route)) throw new HttpError(404, 'Not found.');
    if (request.headers.get('Origin') && !origin) {
      throw new HttpError(403, 'This site may not use the worker. Add it to ALLOWED_ORIGINS.');
    }
    const body = await readBody(request);
    const page = validatePage(body);
    await authorize(request, page, env, now);
    return json(await routes[route](body, env, now, page), 200, origin);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, code: error.extra?.setup ? 'setup' : '' }, error.status, origin);
    }
    return json({ error: 'Something went wrong in the __TITLE__ worker.' }, 500, origin);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
