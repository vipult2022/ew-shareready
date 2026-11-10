/**
 * AEM admin API (publish and status), the ShareReady worker client and share links.
 * Sites on the newer AEM API (api.aem.live) are tried when the classic endpoint says 404.
 */

export const HLX_ADMIN = 'https://admin.hlx.page';
export const AEM_API = 'https://api.aem.live';
export const DA_ADMIN = 'https://admin.da.live';

const UTM = /^[a-zA-Z0-9._~ -]{1,80}$/;

/** The DA document path for a page path: "/" is "/index", ".html" is dropped. */
export function docPath(path) {
  const clean = String(path || '/').replace(/\.html$/, '');
  return clean.endsWith('/') ? `${clean}index` : clean;
}

/** The public path: "/index" is "/", "/x/index" is "/x/". */
export function webPath(path) {
  return docPath(path).replace(/(^|\/)index$/, '$1');
}

/** Candidate URLs for an AEM admin API call: classic first, then the newer AEM API. */
export function adminUrls(api, { org, repo, path }) {
  const p = docPath(path).toLowerCase();
  return [
    `${HLX_ADMIN}/${api}/${org}/${repo}/main${p}`,
    `${AEM_API}/${org}/sites/${repo}/${api}${p}`,
  ];
}

/** Candidate URLs for a DA source document. */
export function sourceUrls({ org, repo, path }) {
  const p = `${docPath(path)}.html`;
  return [`${DA_ADMIN}/source/${org}/${repo}${p}`, `${AEM_API}/${org}/sites/${repo}/source${p}`];
}

/**
 * Fetches the first URL that answers. A 404 moves on to the next URL; anything else
 * (success or a real error such as 401/403) is returned as is.
 */
export async function fetchFirst(fetcher, urls, opts = {}) {
  let last;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      last = await fetcher.auth(urls[i], opts);
      if (last.status !== 404) return last;
    } catch (error) {
      last = { ok: false, status: 0, error };
    }
  }
  return last;
}

function adminOpts(fetcher, method = 'GET') {
  return {
    method,
    headers: fetcher.token ? { 'x-content-source-authorization': `Bearer ${fetcher.token}` } : {},
  };
}

async function readJson(resp) {
  try {
    return await resp.json();
  } catch {
    return {};
  }
}

function adminError(resp, action) {
  const status = resp?.status || 0;
  const detail = resp?.headers?.get?.('x-error') || '';
  if (status === 401 || status === 403) {
    return `You are not allowed to ${action} this page (${status}). Use Publish in the toolbar instead.`;
  }
  if (!status) return `Could not reach AEM to ${action} the page.`;
  return `Could not ${action} the page (${status}${detail ? `: ${detail}` : ''}).`;
}

export async function getStatus(fetcher, context) {
  const resp = await fetchFirst(fetcher, adminUrls('status', context), adminOpts(fetcher));
  if (!resp?.ok) return { ok: false, error: adminError(resp, 'check') };
  return { ok: true, ...(await readJson(resp)) };
}

function time(value) {
  const t = Date.parse(value || '');
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Summarises an admin status response:
 * "unpublished" (never live), "changed" (the draft or preview is newer than live),
 * "live" (up to date) or "unknown".
 */
export function describeStatus(status) {
  if (!status?.ok) return { state: 'unknown', publish: true };
  const live = status.live || {};
  const liveTime = time(live.lastModified);
  const newest = Math.max(time(status.edit?.lastModified), time(status.preview?.lastModified));
  const base = { liveUrl: live.url || '', lastPublished: live.lastModified || '' };
  if (live.status === 404 || !liveTime) return { ...base, state: 'unpublished', publish: true };
  if (newest > liveTime + 1000) return { ...base, state: 'changed', publish: true };
  return { ...base, state: 'live', publish: false };
}

/** Previews then publishes the page, like the toolbar's Publish button. */
export async function publishPage(fetcher, context) {
  const steps = [['preview', 'preview'], ['live', 'publish']];
  let json = {};
  for (let i = 0; i < steps.length; i += 1) {
    const [api, action] = steps[i];
    // eslint-disable-next-line no-await-in-loop
    const resp = await fetchFirst(fetcher, adminUrls(api, context), adminOpts(fetcher, 'POST'));
    if (!resp?.ok) return { ok: false, error: adminError(resp, action) };
    // eslint-disable-next-line no-await-in-loop
    json = await readJson(resp);
  }
  return { ok: true, url: json.live?.url || '', webPath: json.webPath || '' };
}

export function withUtm(url, utm = {}) {
  const u = new URL(url);
  ['source', 'medium', 'campaign', 'content'].forEach((name) => {
    const value = String(utm[name] ?? '').trim();
    if (UTM.test(value)) u.searchParams.set(`utm_${name}`, value);
  });
  return u.href;
}

/** A readable campaign name from the config or the page path ("/offers/spring-savings"). */
export function campaignFor(config, path) {
  if (config['utm-campaign']) return config['utm-campaign'];
  const slug = webPath(path).split('/').filter(Boolean).pop();
  return slug || 'home';
}

export function utmFor(source, config, path) {
  return {
    source: source === 'slack' && config['utm-source'] ? config['utm-source'] : source,
    medium: config['utm-medium'] || 'social',
    campaign: campaignFor(config, path),
  };
}

/** Links that open each network's share box with the page (and its UTM tags) filled in. */
export function shareLinks(url, { title = '', config = {}, path = '/' } = {}) {
  const tagged = (source) => encodeURIComponent(withUtm(url, utmFor(source, config, path)));
  const handle = (config['x-handle'] || '').replace(/^@/, '');
  const text = encodeURIComponent(title);
  return [
    { id: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${tagged('linkedin')}` },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${tagged('facebook')}` },
    { id: 'x', label: 'X', href: `https://x.com/intent/post?url=${tagged('x')}&text=${text}${handle ? `&via=${encodeURIComponent(handle)}` : ''}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${title} ${withUtm(url, utmFor('whatsapp', config, path))}`.trim())}` },
  ];
}

export function linkedinInspector(url) {
  return `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`;
}

export function facebookDebugger(url) {
  return `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`;
}

/* ShareReady worker */

function workerBase(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export async function workerStatus(url, timeout = 6000) {
  const base = workerBase(url);
  if (!base) return { ok: false, error: 'The worker-url setting is not a valid https URL.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(`${base}/status`, { signal: ctrl.signal });
    const data = await readJson(resp);
    if (!resp.ok || !data.features) return { ok: false, error: data.error || `The worker answered ${resp.status}.` };
    return { ok: true, features: data.features };
  } catch {
    return { ok: false, error: 'Could not reach the ShareReady worker. Check worker-url and ALLOWED_ORIGINS.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one or more worker steps for the page. Never throws. */
export async function workerShare(url, token, body) {
  const base = workerBase(url);
  if (!base) return { ok: false, error: 'The worker-url setting is not a valid https URL.' };
  try {
    const resp = await fetch(`${base}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await readJson(resp);
    if (!resp.ok) return { ok: false, error: data.error || `The worker answered ${resp.status}.` };
    return data;
  } catch {
    return { ok: false, error: 'Could not reach the ShareReady worker.' };
  }
}
