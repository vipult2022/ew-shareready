/**
 * ShareReady worker helpers. The worker keeps the Meta app secret and the Slack webhook out
 * of the browser and only acts for people who can read the page in Document Authoring.
 */

export const DA_ADMIN = 'https://admin.da.live';
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const PATH = /^(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)+$|^\/$/;
const KEY = /^[a-zA-Z0-9-]{8,128}$/;
const UTM = /^[a-zA-Z0-9._~ -]{1,80}$/;
const AUTH_TTL = 5 * 60 * 1000;
const RATE_LIMIT = 30;

export const DEFAULT_ORIGINS = [
  'https://da.live',
  'https://*.da.live',
  'https://*.aem.page',
  'https://*.aem.live',
  'http://localhost:3000',
];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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

/** The DA document path for a page path: "/" is "/index", ".html" is dropped. */
export function docPath(path) {
  const clean = String(path || '/').replace(/\.html$/, '');
  return clean.endsWith('/') ? `${clean}index` : clean;
}

/** The public URL path for a page path: "/index" and "/x/index" lose the "index". */
export function pagePath(path) {
  return docPath(path).replace(/(^|\/)index$/, '$1');
}

export function validatePage({ org, site, path } = {}) {
  if (!NAME.test(org || '') || !NAME.test(site || '') || !PATH.test(path || '')) {
    throw new HttpError(400, 'The request is missing a valid org, site and page path.');
  }
  if (path.split('/').some((part) => part === '..' || part === '.')) {
    throw new HttpError(400, 'The page path is not valid.');
  }
  return { org: org.toLowerCase(), site: site.toLowerCase(), path };
}

export function checkOrg({ org, site }, env) {
  const allowed = list(env.ALLOWED_ORGS);
  if (!allowed.length) {
    throw new HttpError(500, 'The worker is not set up yet: set ALLOWED_ORGS (for example "my-org" or "my-org/my-site").');
  }
  if (!allowed.includes(org) && !allowed.includes(`${org}/${site}`)) {
    throw new HttpError(403, `This worker does not share pages from ${org}/${site}. Add it to ALLOWED_ORGS.`);
  }
}

/** Which public URL to share. Only the site's own aem.live/aem.page hosts or ALLOWED_HOSTS. */
export function shareUrl({ org, site, path }, host, env) {
  const own = [`main--${site}--${org}.aem.live`, `main--${site}--${org}.aem.page`];
  const target = String(host || own[0]).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!own.includes(target) && !list(env.ALLOWED_HOSTS).includes(target)) {
    throw new HttpError(403, `${target} is not one of this site's hosts. Add it to ALLOWED_HOSTS on the worker.`);
  }
  return `https://${target}${pagePath(path)}`;
}

async function sha256(text) {
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

function rateLimit(key, now) {
  const entry = rates.get(key);
  if (!entry || entry.reset < now) {
    rates.set(key, { count: 1, reset: now + 60000 });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) throw new HttpError(429, 'Too many requests. Try again in a minute.');
}

/**
 * Confirms the caller's Adobe IMS token can read the page through the DA source API.
 * Results are cached for five minutes per token and page.
 */
export async function authorize(request, page, env, now = Date.now()) {
  const header = request.headers.get('Authorization') || '';
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to Experience Workspace and try again.');
  checkOrg(page, env);
  const tokenKey = await sha256(token);
  rateLimit(tokenKey, now);
  const key = `${tokenKey}|${page.org}/${page.site}${docPath(page.path)}`;
  if (authCache.get(key) > now) return;
  let resp;
  try {
    resp = await fetch(`${DA_ADMIN}/source/${page.org}/${page.site}${docPath(page.path)}.html`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new HttpError(502, 'Could not reach Document Authoring to check your access.');
  }
  if (resp.status === 401) throw new HttpError(401, 'Your session expired. Reload Experience Workspace and try again.');
  if (resp.status === 403) throw new HttpError(403, 'You do not have access to this page.');
  if (resp.status === 404) throw new HttpError(404, 'This page was not found in Document Authoring.');
  if (!resp.ok) throw new HttpError(502, `Document Authoring answered ${resp.status}.`);
  authCache.set(key, now + AUTH_TTL);
  if (authCache.size > 1000) authCache.delete(authCache.keys().next().value);
}

export function withUtm(url, utm = {}) {
  const u = new URL(url);
  ['source', 'medium', 'campaign', 'content'].forEach((name) => {
    const value = String(utm[name] ?? '').trim();
    if (UTM.test(value)) u.searchParams.set(`utm_${name}`, value);
  });
  return u.href;
}

function decode(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Reads the share card (og/twitter tags) from a published page's HTML. */
export function readCard(html) {
  const meta = (key) => {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i'))?.[0];
    const value = tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    return value ? decode(value[1] ?? value[2]).trim() : '';
  };
  const title = meta('og:title') || meta('twitter:title') || decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim();
  return {
    title,
    description: meta('og:description') || meta('description') || meta('twitter:description'),
    image: meta('og:image') || meta('twitter:image'),
    imageAlt: meta('og:image:alt') || meta('twitter:image:alt'),
  };
}

function skipped(reason) {
  return { ok: false, skipped: true, message: reason };
}

/** Asks Facebook to re-read the page's Open Graph tags, so new shares show the new card. */
export async function scrapeFacebook(url, env) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return skipped('Facebook is not set up. Add META_APP_ID and META_APP_SECRET to the worker.');
  }
  const version = env.META_GRAPH_VERSION ? `${env.META_GRAPH_VERSION}/` : '';
  const debuggerUrl = `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`;
  let resp;
  try {
    resp = await fetch(`https://graph.facebook.com/${version}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id: url,
        scrape: 'true',
        access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
      }),
    });
  } catch {
    return { ok: false, message: 'Could not reach Facebook.', debugger: debuggerUrl };
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    return {
      ok: false,
      message: `Facebook: ${data.error?.message || `HTTP ${resp.status}`}`,
      debugger: debuggerUrl,
    };
  }
  return {
    ok: true,
    message: 'Facebook refreshed its preview.',
    title: data.title || '',
    description: data.description || '',
    image: data.image?.[0]?.url || '',
    updated: data.updated_time || '',
    debugger: debuggerUrl,
  };
}

const INDEXNOW_STATUS = {
  200: 'Search engines were notified.',
  202: 'IndexNow accepted the URL. The key is still being checked.',
  400: 'IndexNow rejected the request.',
  403: 'IndexNow could not find the key file at the site root.',
  422: 'The URL does not belong to the host, or the key does not match.',
  429: 'IndexNow is rate limiting this site. Try later.',
};

/** Tells IndexNow search engines (Bing, Yandex, Seznam, Naver...) that the page changed. */
export async function pingIndexNow(url, env) {
  const key = env.INDEXNOW_KEY;
  if (!key) return skipped('IndexNow is not set up. Add INDEXNOW_KEY to the worker.');
  if (!KEY.test(key)) return { ok: false, message: 'INDEXNOW_KEY must be 8 to 128 letters, digits or dashes.' };
  const { host } = new URL(url);
  let resp;
  try {
    resp = await fetch(env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host, key, keyLocation: `https://${host}/${key}.txt`, urlList: [url],
      }),
    });
  } catch {
    return { ok: false, message: 'Could not reach IndexNow.' };
  }
  return {
    ok: resp.status === 200 || resp.status === 202,
    status: resp.status,
    message: INDEXNOW_STATUS[resp.status] || `IndexNow answered ${resp.status}.`,
  };
}

function slackText(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackMessage({
  card, url, editUrl, note, host,
}) {
  const title = card.title || url;
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*<${url}|${slackText(title)}>*${card.description ? `\n${slackText(card.description)}` : ''}` },
    },
  ];
  if (card.image) {
    blocks.push({
      type: 'image', image_url: card.image, alt_text: (card.imageAlt || title).slice(0, 2000),
    });
  }
  if (note) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `>${slackText(note).slice(0, 1500).replace(/\n/g, '\n>')}` } });
  }
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button', text: { type: 'plain_text', text: 'Open page' }, url, style: 'primary',
      },
      { type: 'button', text: { type: 'plain_text', text: 'Edit in EW' }, url: editUrl },
    ],
  });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Shared with ShareReady from Experience Workspace · ${slackText(host)}` }],
  });
  return { text: `${title} ${url}`, unfurl_links: false, blocks };
}

/** Posts a share card to the team's Slack channel through an incoming webhook. */
export async function postSlack({
  url, page, utm, note, fallback,
}, env) {
  if (!env.SLACK_WEBHOOK_URL) return skipped('Slack is not set up. Add SLACK_WEBHOOK_URL to the worker.');
  let card = {};
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'ShareReady (+https://www.aem.live)' } });
    if (resp.ok) card = readCard(await resp.text());
  } catch {
    // Fall back to the values the panel sent.
  }
  const safe = fallback || {};
  const merged = {
    title: card.title || String(safe.title || ''),
    description: card.description || String(safe.description || ''),
    image: card.image || (/^https:\/\//.test(safe.image || '') ? safe.image : ''),
    imageAlt: card.imageAlt || String(safe.imageAlt || ''),
  };
  const editUrl = `https://da.live/canvas#/${page.org}/${page.site}${docPath(page.path)}`;
  const shared = withUtm(url, utm);
  const message = slackMessage({
    card: merged, url: shared, editUrl, note: String(note || '').trim(), host: new URL(url).host,
  });
  let resp;
  try {
    resp = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch {
    return { ok: false, message: 'Could not reach Slack.' };
  }
  if (!resp.ok) {
    const text = (await resp.text().catch(() => '')).slice(0, 200);
    return { ok: false, message: `Slack: ${text || `HTTP ${resp.status}`}` };
  }
  return {
    ok: true,
    message: `Posted to ${env.SLACK_CHANNEL || 'Slack'}.`,
    url: shared,
    card: merged,
  };
}

export function features(env) {
  return {
    facebook: !!(env.META_APP_ID && env.META_APP_SECRET),
    indexnow: !!env.INDEXNOW_KEY,
    slack: !!env.SLACK_WEBHOOK_URL,
    slackChannel: env.SLACK_CHANNEL || '',
  };
}
