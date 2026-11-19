/**
 * Notion worker: holds the Notion integration secret, so a whole site can read Notion
 * without giving authors a token. Notion's API does not allow browser calls, so the panel
 * always goes through this worker. Every call except /status needs the author's IMS token
 * and only works for a page that token can read in Document Authoring.
 *
 *   GET  /status     whether the worker is set up (no token needed)
 *   POST /databases  databases shared with the integration
 *   POST /database   one database and its entries           { database }
 *   POST /search     pages shared with the integration       { query }
 *   POST /page       a page's properties and blocks          { page }
 *   POST /link       write the new page's link into Notion   { page, url }
 *   POST /file       download an image for copying to DA      { url }
 *
 * Every body also carries { org, site, path } for the page open in Experience Workspace.
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, authorize, list,
} from './http.js';
import {
  NotionError, tokenCall, cleanId, searchPages, listDatabases, queryDatabase, getPage,
  setUrlProperty,
} from '../../lib/notion.js';

const CACHE_TTL = 60000;
const MAX_FILE = 20 * 1024 * 1024;
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

function setup(env) {
  if (!env.NOTION_TOKEN) {
    throw new HttpError(500, 'The worker is not set up yet: add the NOTION_TOKEN secret.', { setup: true });
  }
  return tokenCall(env.NOTION_TOKEN);
}

function id(value, what) {
  const clean = cleanId(value);
  if (!clean) throw new HttpError(400, `Choose a Notion ${what}.`);
  return clean;
}

/** NOTION_DATABASES limits the worker to some databases; empty means everything shared. */
function allowedDatabases(env) {
  return list(env.NOTION_DATABASES).map(cleanId).filter(Boolean);
}

function checkDatabase(database, env) {
  const allowed = allowedDatabases(env);
  if (allowed.length && !allowed.includes(database)) {
    throw new HttpError(403, 'This worker may not read that database. Add it to NOTION_DATABASES.');
  }
}

/** Only links to the author's own site: its EW editor or its aem.page / aem.live pages. */
export function siteLink(url, { org, site }) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  if (parsed.host === 'da.live') {
    return new RegExp(`^#/${org}/${site}/[a-z0-9][a-z0-9/._-]*$`, 'i').test(parsed.hash)
      && ['/canvas', '/edit'].includes(parsed.pathname);
  }
  return new RegExp(`^[a-z0-9-]+--${site}--${org}\\.aem\\.(page|live)$`, 'i').test(parsed.host);
}

const routes = {
  async databases(body, env, now) {
    const call = setup(env);
    const all = await memo('dbs', () => listDatabases(call), now);
    const allowed = allowedDatabases(env);
    return { databases: allowed.length ? all.filter((d) => allowed.includes(d.id)) : all };
  },
  async database(body, env, now) {
    const call = setup(env);
    const database = id(body.database, 'database');
    checkDatabase(database, env);
    return memo(`db|${database}`, () => queryDatabase(call, database), now);
  },
  async search(body, env, now) {
    const call = setup(env);
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 200) : '';
    const result = await memo(`s|${query}`, () => searchPages(call, query), now);
    const allowed = allowedDatabases(env);
    if (!allowed.length) return result;
    return { ...result, pages: result.pages.filter((p) => allowed.includes(p.database)) };
  },
  async page(body, env, now) {
    const call = setup(env);
    const page = id(body.page, 'page');
    const result = await memo(`p|${page}`, () => getPage(call, page), now);
    if (allowedDatabases(env).length) checkDatabase(result.page.database, env);
    return result;
  },
  async link(body, env, now, page) {
    const call = setup(env);
    if (/^(no|false|off|0)$/i.test(env.ALLOW_WRITE || '')) {
      throw new HttpError(403, 'This worker does not write to Notion (ALLOW_WRITE is off).');
    }
    const target = id(body.page, 'page');
    if (!siteLink(body.url, page)) {
      throw new HttpError(400, 'Only links to pages of this site can be written to Notion.');
    }
    if (allowedDatabases(env).length) {
      const { page: found } = await memo(`p|${target}`, () => getPage(call, target), now);
      checkDatabase(found.database, env);
    }
    cache.delete(`p|${target}`);
    return setUrlProperty(call, target, env.LINK_PROPERTY || 'EW page', body.url);
  },
};

/** Images that the browser cannot download itself (no CORS), for copying into the site. */
async function file(body, origin) {
  let url;
  try {
    url = new URL(String(body.url || ''));
  } catch {
    throw new HttpError(400, 'That image link is not valid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new HttpError(400, 'Only https image links can be copied.');
  }
  let resp;
  try {
    resp = await fetch(url.href, { headers: { Accept: 'image/*' } });
  } catch {
    throw new HttpError(502, 'Could not download the image.');
  }
  const type = (resp.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!resp.ok) throw new HttpError(502, `The image server answered ${resp.status}.`);
  if (!type.startsWith('image/') || type === 'image/svg+xml') {
    throw new HttpError(415, 'That link is not a picture.');
  }
  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength > MAX_FILE) throw new HttpError(413, 'The image is larger than 20 MB.');
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

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
        service: 'notion',
        configured: !!env.NOTION_TOKEN && list(env.ALLOWED_ORGS).length > 0,
        limitedDatabases: allowedDatabases(env).length > 0,
        write: !/^(no|false|off|0)$/i.test(env.ALLOW_WRITE || ''),
        linkProperty: env.LINK_PROPERTY || 'EW page',
      }, 200, origin);
    }
    if (request.method !== 'POST' || !(routes[route] || route === 'file')) {
      throw new HttpError(404, 'Not found.');
    }
    if (request.headers.get('Origin') && !origin) throw new HttpError(403, 'This site may not use the worker. Add it to ALLOWED_ORIGINS.');
    const body = await readBody(request);
    const page = validatePage(body);
    await authorize(request, page, env, now);
    if (route === 'file') return await file(body, origin);
    return json(await routes[route](body, env, now, page), 200, origin);
  } catch (error) {
    if (error instanceof HttpError || error instanceof NotionError) {
      return json({ error: error.message, code: error.code || (error.extra?.setup ? 'setup' : '') }, error.status, origin);
    }
    return json({ error: 'Something went wrong in the Notion worker.' }, 500, origin);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
