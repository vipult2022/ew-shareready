/**
 * ReviewLoop worker: keeps the Jira and Airtable credentials out of the browser. Every
 * call except /status needs the author's IMS token, and only works for pages that token
 * can read. A worker can connect to Jira, Airtable or both; each review type picks one.
 *
 *   GET  /status            connected trackers: Jira site and project, Airtable base and table
 *   POST /page              preview and live .plain.html of the page
 *   POST /review/get        the latest review of the page, plus the author's name
 *   POST /review/create     new Jira issue or Airtable record with the changes since live
 *   POST /review/resubmit   comment with the changes since the last round, back to review
 *   POST /review/published  comment with the live URL, review to done
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, authorize, imsUser,
  pageUrls, webPath,
} from './http.js';
import { jiraTracker, jiraConfigured } from './jira.js';
import { airtableTracker, airtableConfigured } from './airtable.js';
import { pageLabel } from './review.js';

const MAX_ADF = 32000;

function text(value, max, field, required = false) {
  const clean = String(value ?? '').trim();
  if (required && !clean) throw new HttpError(400, `The request is missing ${field}.`);
  return clean.slice(0, max);
}

function adf(value, field) {
  const ok = value && value.type === 'doc' && value.version === 1 && Array.isArray(value.content);
  if (!ok) throw new HttpError(400, `The ${field} is not a valid Jira document.`);
  if (JSON.stringify(value).length > MAX_ADF) throw new HttpError(413, `The ${field} is too long for Jira.`);
  return value;
}

function snapshot(value) {
  if (!value || !Array.isArray(value.units)) throw new HttpError(400, 'The request is missing the page snapshot.');
  return { v: value.v || 1, units: value.units, complete: value.complete !== false };
}

const PLAIN_TIMEOUT = 8000;
const STALE_SLACK = 2000;
const STALE_RETRY = 1500;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchPlain(url) {
  // A unique query string skips CDN edges that still hold the copy from before a preview.
  const fresh = `${url}?rl=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return fetch(fresh, {
    cache: 'no-store',
    signal: AbortSignal.timeout(PLAIN_TIMEOUT),
    headers: { 'User-Agent': 'ReviewLoop (+https://www.aem.live)' },
  });
}

const MAIN = /<main[^>]*>([\s\S]*)<\/main>/i;
const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i;

async function fetchOnce(url) {
  try {
    return await fetchPlain(url);
  } catch {
    return fetchPlain(url);
  }
}

/**
 * The page as .plain.html would give it. Read from the full page's <main>, because some
 * CDN nodes keep serving an old .plain.html for minutes after a preview, while the page
 * itself is fresh. Falls back to .plain.html if the page has no <main>.
 */
async function plain(host, page) {
  const web = webPath(page.path);
  const origin = `https://main--${page.site}--${page.org}.${host}`;
  let resp;
  try {
    resp = await fetchOnce(`${origin}${web}`);
    if (resp.ok) {
      const html = await resp.text();
      const main = html.match(MAIN);
      if (main) {
        return {
          text: main[1].trim(),
          head: html.match(HEAD)?.[1].trim() || '',
          modified: Date.parse(resp.headers.get('last-modified') || ''),
        };
      }
    }
    if (resp.status !== 404) {
      const file = web.endsWith('/') ? `${web}index` : web;
      resp = await fetchOnce(`${origin}${file}.plain.html`);
    }
  } catch {
    throw new HttpError(502, `Could not reach ${host}.`);
  }
  if (resp.status === 404) return null;
  if (!resp.ok) throw new HttpError(502, `${host} answered ${resp.status} for this page.`);
  return { text: await resp.text(), head: '', modified: Date.parse(resp.headers.get('last-modified') || '') };
}

/** True when the CDN still serves a copy older than the preview the author just made. */
function isStale(copy, since) {
  return Boolean(copy && since && copy.modified && copy.modified < since - STALE_SLACK);
}

/** The trackers this worker is connected to, and the one new reviews use by default. */
export function trackersFrom(env = {}) {
  const all = [];
  if (jiraConfigured(env)) all.push(jiraTracker(env));
  if (airtableConfigured(env)) all.push(airtableTracker(env));
  const ready = all.filter((t) => !t.missing.length);
  const wanted = String(env.DEFAULT_TRACKER || '').trim().toLowerCase();
  return { all, ready, fallback: ready.find((t) => t.id === wanted) || ready[0] || null };
}

function notConnected(trackers) {
  if (trackers.all.length) return trackers.all[0].setupError();
  return new HttpError(500, 'The ReviewLoop worker is not connected to Jira or Airtable yet. Set the JIRA_* or AIRTABLE_* settings.', { setup: true });
}

/** The tracker a request asks for by id ('' for the default). */
function pick(trackers, id) {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted) {
    if (!trackers.fallback) throw notConnected(trackers);
    return trackers.fallback;
  }
  const ready = trackers.ready.find((t) => t.id === wanted);
  if (ready) return ready;
  const half = trackers.all.find((t) => t.id === wanted);
  if (half) throw half.setupError();
  const name = { jira: 'Jira', airtable: 'Airtable' }[wanted];
  if (!name) throw new HttpError(400, `“${text(id, 30)}” is not a tracker ReviewLoop knows. Use jira or airtable.`);
  throw new HttpError(400, `The ReviewLoop worker is not connected to ${name}. Set the ${wanted.toUpperCase()}_* settings, or pick another tracker for this review type.`, { setup: true });
}

/** The trackers to look in: the ones the site's review types use, or all connected ones. */
function searched(trackers, body) {
  const ids = Array.isArray(body.trackers) ? body.trackers.slice(0, 5) : null;
  if (!ids?.length) {
    if (!trackers.ready.length) throw notConnected(trackers);
    return trackers.ready;
  }
  return [...new Set(ids.map((id) => pick(trackers, id)))];
}

/** The page's newest review across trackers, plus how often the panel should check. */
async function latest(ctx) {
  const list = searched(ctx.trackers, ctx.body);
  const reviews = (await Promise.all(list.map((t) => t.latest(ctx.label)))).filter(Boolean);
  const review = reviews.reduce((newest, r) => (
    !newest || Date.parse(r.createdAt) > Date.parse(newest.createdAt) ? r : newest), null);
  return { review, poll: Math.max(...list.map((t) => t.poll)) };
}

/** The tracker that holds a review key: NWB-12 is Jira, RL-ABC123 or rec… is Airtable. */
function owner(ctx) {
  const { body, trackers } = ctx;
  if (body.tracker) return pick(trackers, body.tracker);
  const found = trackers.ready.find((t) => t.owns(body.key));
  if (!found) throw new HttpError(400, 'The request is missing a valid review key.');
  return found;
}

const ROUTES = {
  '/page': async function versions({ page, body }) {
    // The panel reads the draft from DA itself and only needs live (with its <head>, for
    // the published metadata).
    if (body.liveOnly) {
      const live = await plain('aem.live', page);
      return { live: live?.text || '', liveHead: live?.head || '' };
    }
    const since = Date.parse(body.since || '') || 0;
    const [first, live] = await Promise.all([plain('aem.page', page), plain('aem.live', page)]);
    let preview = first;
    if (preview === null) throw new HttpError(404, 'This page has no preview yet. Preview it, then try again.');
    if (isStale(preview, since)) {
      await wait(STALE_RETRY);
      preview = await plain('aem.page', page) || preview;
    }
    return {
      preview: preview.text, live: live?.text || '', liveHead: live?.head || '', stale: isStale(preview, since),
    };
  },

  '/review/get': async function getReview(ctx) {
    const [{ review, poll }, user] = await Promise.all([latest(ctx), imsUser(ctx.auth)]);
    return { review, user, poll };
  },

  '/review/create': async function createReview(ctx) {
    const { body, page } = ctx;
    const summary = text(body.summary, 250, 'a summary', true);
    const description = adf(body.description, 'description');
    const shot = snapshot(body.snapshot);
    const tracker = pick(ctx.trackers, body.tracker);
    const trackers = body.trackers ? [...body.trackers, tracker.id] : null;
    const look = { ...ctx, body: { ...body, trackers } };
    const { review: existing } = await latest(look);
    if (existing && existing.state !== 'done') throw new HttpError(409, `${existing.key} is already open for this page.`);
    const user = await imsUser(ctx.auth);
    return tracker.create({
      label: ctx.label,
      page,
      urls: pageUrls(page),
      summary,
      description,
      due: /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : '',
      assignee: text(body.assignee, 100),
      reviewType: text(body.reviewType, 60),
      user,
      snapshot: shot,
    });
  },

  '/review/resubmit': async function resubmitReview(ctx) {
    const { body } = ctx;
    const comment = adf(body.comment, 'comment');
    const shot = snapshot(body.snapshot);
    const tracker = owner(ctx);
    const user = await imsUser(ctx.auth);
    const review = await tracker.resubmit({
      label: ctx.label, key: body.key, comment, text: text(body.text, 1000), user, snapshot: shot,
    });
    return { review };
  },

  '/review/published': async function publishedReview(ctx) {
    const { body, page } = ctx;
    const comment = adf(body.comment, 'comment');
    const tracker = owner(ctx);
    const user = await imsUser(ctx.auth);
    return tracker.published({
      label: ctx.label, key: body.key, comment, user, liveUrl: pageUrls(page).liveUrl,
    });
  },
};

async function status(env) {
  const trackers = trackersFrom(env);
  if (!trackers.ready.length) throw notConnected(trackers);
  const results = await Promise.allSettled(trackers.ready.map((t) => t.status()));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed && results.every((r) => r.status === 'rejected')) throw failed.reason;
  const out = { name: 'reviewloop', default: trackers.fallback.id, trackers: [] };
  trackers.all.forEach((t) => {
    const i = trackers.ready.indexOf(t);
    const result = i < 0 ? { status: 'rejected', reason: t.setupError() } : results[i];
    if (result.status === 'fulfilled') out[t.id] = result.value;
    out.trackers.push({
      id: t.id,
      name: t.name,
      ready: result.status === 'fulfilled',
      ...(result.status === 'rejected' ? { error: result.reason?.message || 'Not available.' } : {}),
    });
  });
  return out;
}

async function handle(request, env, pathname) {
  const body = await readBody(request);
  const page = validatePage(body);
  const auth = await authorize(request, page, env);
  const ctx = {
    body, page, env, auth,
  };
  if (pathname !== '/page') {
    ctx.trackers = trackersFrom(env);
    ctx.label = await pageLabel(page);
  }
  return ROUTES[pathname](ctx);
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin');
    const origin = allowedOrigin(requestOrigin, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
    }
    if (requestOrigin && !origin) {
      return json({ ok: false, error: `${requestOrigin} may not call this worker. Add it to ALLOWED_ORIGINS.` }, 403);
    }
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/status')) {
        return json({ ok: true, ...(await status(env)) }, 200, origin);
      }
      if (request.method === 'POST' && Object.hasOwn(ROUTES, pathname)) {
        return json({ ok: true, ...(await handle(request, env, pathname)) }, 200, origin);
      }
      return json({ ok: false, error: 'Not found.' }, 404, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        const setup = error.extra?.setup ? { setup: true } : {};
        return json({ ok: false, error: error.message, ...setup }, error.status, origin);
      }
      // eslint-disable-next-line no-console
      console.error(error);
      return json({ ok: false, error: 'Something went wrong in the ReviewLoop worker.' }, 500, origin);
    }
  },
};
