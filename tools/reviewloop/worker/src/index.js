/**
 * ReviewLoop worker: keeps the Jira API token out of the browser. Every call except /status
 * needs the author's IMS token, and only works for pages that token can read.
 *
 *   GET  /status            Jira site and project (no token needed)
 *   POST /page              preview and live .plain.html of the page
 *   POST /review/get        the latest review of the page, plus the author's name
 *   POST /review/create     new Jira issue with the changes since live
 *   POST /review/resubmit   comment with the changes since the last round, back to review
 *   POST /review/published  comment with the live URL, issue to done
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, authorize, imsUser,
  pageUrls, webPath,
} from './http.js';
import {
  jiraConfig, createJira, setupError, pageLabel, checkKey, toReview, PROPERTY,
} from './jira.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
      if (main) return { text: main[1].trim(), modified: Date.parse(resp.headers.get('last-modified') || '') };
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
  return { text: await resp.text(), modified: Date.parse(resp.headers.get('last-modified') || '') };
}

/** True when the CDN still serves a copy older than the preview the author just made. */
function isStale(copy, since) {
  return Boolean(copy && since && copy.modified && copy.modified < since - STALE_SLACK);
}

/** The page's issue, checked to belong to this page (so a key from elsewhere is refused). */
async function ownIssue(ctx, key) {
  const issue = await ctx.jira.getIssue(checkKey(key));
  if (!(issue.fields?.labels || []).includes(ctx.label)) {
    throw new HttpError(403, `${key} is not the review for this page.`);
  }
  return issue;
}

async function current(ctx, key) {
  return toReview(await ctx.jira.getIssue(key), ctx.cfg);
}

const ROUTES = {
  '/page': async function versions({ page, body }) {
    const since = Date.parse(body.since || '') || 0;
    let [preview, live] = await Promise.all([plain('aem.page', page), plain('aem.live', page)]);
    if (preview === null) throw new HttpError(404, 'This page has no preview yet. Preview it, then try again.');
    if (isStale(preview, since)) {
      await wait(STALE_RETRY);
      preview = await plain('aem.page', page) || preview;
    }
    live = live?.text || '';
    return { preview: preview.text, live, stale: isStale(preview, since) };
  },

  '/review/get': async function getReview(ctx) {
    const key = await ctx.jira.findKey(ctx.label);
    const [review, user] = await Promise.all([
      key ? current(ctx, key) : null,
      imsUser(ctx.auth),
    ]);
    return { review, user };
  },

  '/review/create': async function createReview(ctx) {
    const { body, page, jira } = ctx;
    const summary = text(body.summary, 250, 'a summary', true);
    const description = adf(body.description, 'description');
    const shot = snapshot(body.snapshot);
    const existing = await jira.findKey(ctx.label);
    if (existing) {
      const review = await current(ctx, existing);
      if (review.state !== 'done') throw new HttpError(409, `${existing} is already open for this page.`);
    }
    const [user, accountId] = await Promise.all([
      imsUser(ctx.auth),
      jira.findAssignee(text(body.assignee, 100)).catch(() => null),
    ]);
    const fields = {
      project: { key: ctx.cfg.project },
      issuetype: { name: ctx.cfg.issueType },
      summary,
      description,
      labels: ['reviewloop', ctx.label],
    };
    if (DATE.test(body.due || '')) fields.duedate = body.due;
    if (accountId) fields.assignee = { accountId };
    const created = await jira.createIssue(fields);
    const { key } = created;
    const urls = pageUrls(page);
    await jira.setProperty(key, {
      v: 1,
      org: page.org,
      site: page.site,
      path: page.path,
      reviewType: text(body.reviewType, 60),
      round: 1,
      requestedAt: new Date().toISOString(),
      requester: user,
      snapshot: shot,
      own: {},
    });
    const moved = await jira.moveTo(key, ctx.cfg.statuses.review);
    await Promise.allSettled([
      jira.link(key, urls.editUrl, 'Edit in Experience Workspace'),
      jira.link(key, urls.previewUrl, 'Preview'),
    ]);
    const warnings = [];
    if (!moved) {
      const options = (jira.available || []).join(', ');
      warnings.push(`No transition to “${ctx.cfg.statuses.review}”, so the issue stayed in its first status. Add that status to the board${options ? ` (it can move to: ${options})` : ''}, or set JIRA_STATUS_REVIEW on the worker.`);
    }
    if (body.assignee && !accountId) warnings.push(`No Jira user called “${text(body.assignee, 100)}”, so the issue is unassigned.`);
    (created.dropped || []).forEach((f) => warnings.push(`The project does not allow ${f === 'duedate' ? 'a due date' : 'an assignee'} on new issues.`));
    const review = await current(ctx, key);
    return {
      key, url: review.url, review, warnings,
    };
  },

  '/review/resubmit': async function resubmitReview(ctx) {
    const { body, jira } = ctx;
    const comment = adf(body.comment, 'comment');
    const shot = snapshot(body.snapshot);
    const issue = await ownIssue(ctx, body.key);
    const prop = issue.properties?.[PROPERTY] || {};
    const round = (prop.round || 1) + 1;
    const user = await imsUser(ctx.auth);
    const id = await jira.addComment(issue.key, comment);
    await jira.setProperty(issue.key, {
      ...prop,
      round,
      requestedAt: new Date().toISOString(),
      snapshot: shot,
      own: {
        ...(prop.own || {}),
        [id]: { by: user || prop.requester || 'Author', text: text(body.text, 1000) || `Sent back for review (round ${round}).` },
      },
    });
    await jira.moveTo(issue.key, ctx.cfg.statuses.review, issue.fields?.status?.name);
    return { review: await current(ctx, issue.key) };
  },

  '/review/published': async function publishedReview(ctx) {
    const { body, page, jira } = ctx;
    const comment = adf(body.comment, 'comment');
    const issue = await ownIssue(ctx, body.key);
    const prop = issue.properties?.[PROPERTY] || {};
    const user = await imsUser(ctx.auth);
    const { liveUrl } = pageUrls(page);
    const id = await jira.addComment(issue.key, comment);
    await jira.setProperty(issue.key, {
      ...prop,
      publishedAt: new Date().toISOString(),
      own: { ...(prop.own || {}), [id]: { by: user || 'Author', text: `Published: ${liveUrl}` } },
    });
    await jira.link(issue.key, liveUrl, 'Live page').catch(() => null);
    const moved = await jira.moveTo(issue.key, ctx.cfg.statuses.done, issue.fields?.status?.name);
    return { moved, warnings: moved ? [] : [`No transition to “${ctx.cfg.statuses.done}”.`] };
  },
};

async function status(env) {
  const cfg = jiraConfig(env);
  if (cfg.missing.length) throw setupError(cfg);
  const jira = createJira(cfg);
  const [project, names] = await Promise.all([jira.project(), jira.statuses().catch(() => null)]);
  const known = (names || []).map((n) => n.toLowerCase());
  const missingStatuses = names
    ? Object.values(cfg.statuses).filter((n) => !known.includes(n.toLowerCase()))
    : [];
  return {
    name: 'reviewloop',
    jira: missingStatuses.length ? { ...project, statuses: names, missingStatuses } : project,
  };
}

async function handle(request, env, pathname) {
  const body = await readBody(request);
  const page = validatePage(body);
  const auth = await authorize(request, page, env);
  const ctx = {
    body, page, env, auth,
  };
  if (pathname !== '/page') {
    ctx.cfg = jiraConfig(env);
    ctx.jira = createJira(ctx.cfg);
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
