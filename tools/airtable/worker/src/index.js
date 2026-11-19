/**
 * Airtable worker: lets a whole site read Airtable with one team token, so authors need no
 * Airtable account. Every call except /status needs the author's IMS token, and only works
 * for a page that token can read in Document Authoring. Read only.
 *
 *   GET  /status    whether the worker is set up (no token needed)
 *   POST /bases     bases the team token can read (and AIRTABLE_BASES allows)
 *   POST /tables    tables, fields and views of a base
 *   POST /records   records of a table or view, as Airtable shows them
 *
 * POST bodies: { org, site, path, base?, table?, view?, locale?, timeZone?, max? }
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, authorize, list,
} from './http.js';
import {
  AirtableError, BASE_ID, MAX_RECORDS, tokenCall, listBases, listTables, listRecords,
} from '../../lib/airtable.js';

const LOCALE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
const TIME_ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
const CACHE_TTL = 60000;
const cache = new Map();

export function resetCache() {
  cache.clear();
}

async function memo(key, run, now) {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  const value = await run();
  cache.set(key, { value, until: now + CACHE_TTL });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

function setup(env) {
  if (!env.AIRTABLE_TOKEN) {
    throw new HttpError(500, 'The worker is not set up yet: add the AIRTABLE_TOKEN secret.', { setup: true });
  }
  return tokenCall(env.AIRTABLE_TOKEN);
}

/** AIRTABLE_BASES limits the worker to some bases; empty means every base the token reads. */
function checkBase(base, env) {
  if (!BASE_ID.test(base || '')) throw new HttpError(400, 'Choose an Airtable base (app…).');
  const allowed = list(env.AIRTABLE_BASES);
  if (allowed.length && !allowed.includes(base.toLowerCase())) {
    throw new HttpError(403, 'This worker is not allowed to read that base. Add it to AIRTABLE_BASES.');
  }
  return base;
}

function recordOptions(body) {
  const max = Math.min(Math.max(Number(body.max) || MAX_RECORDS, 1), MAX_RECORDS);
  return {
    view: typeof body.view === 'string' ? body.view.slice(0, 255) : '',
    locale: LOCALE.test(body.locale || '') ? body.locale : 'en-us',
    timeZone: TIME_ZONE.test(body.timeZone || '') ? body.timeZone : 'UTC',
    max,
  };
}

const routes = {
  async bases(body, env, now) {
    const call = setup(env);
    const bases = await memo('bases', () => listBases(call), now);
    const allowed = list(env.AIRTABLE_BASES);
    if (!allowed.length) return { bases };
    return { bases: bases.filter((b) => allowed.includes(b.id.toLowerCase())) };
  },
  async tables(body, env, now) {
    const call = setup(env);
    const base = checkBase(body.base, env);
    return { tables: await memo(`t|${base}`, () => listTables(call, base), now) };
  },
  async records(body, env, now) {
    const call = setup(env);
    const base = checkBase(body.base, env);
    if (typeof body.table !== 'string' || !body.table.trim()) throw new HttpError(400, 'Choose a table.');
    const opts = recordOptions(body);
    const key = `r|${base}|${body.table}|${opts.view}|${opts.locale}|${opts.timeZone}|${opts.max}`;
    return memo(key, () => listRecords(call, base, body.table.slice(0, 255), opts), now);
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
        service: 'airtable',
        configured: !!env.AIRTABLE_TOKEN && list(env.ALLOWED_ORGS).length > 0,
        limitedBases: list(env.AIRTABLE_BASES).length > 0,
      }, 200, origin);
    }
    if (request.method !== 'POST' || !routes[route]) throw new HttpError(404, 'Not found.');
    if (request.headers.get('Origin') && !origin) throw new HttpError(403, 'This site may not use the worker. Add it to ALLOWED_ORIGINS.');
    const body = await readBody(request);
    const page = validatePage(body);
    await authorize(request, page, env, now);
    return json(await routes[route](body, env, now), 200, origin);
  } catch (error) {
    if (error instanceof HttpError || error instanceof AirtableError) {
      return json({ error: error.message, code: error.code || (error.extra?.setup ? 'setup' : '') }, error.status, origin);
    }
    return json({ error: 'Something went wrong in the Airtable worker.' }, 500, origin);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
