/**
 * The page under review: its URLs, a fresh preview, and what changed since live and
 * since the last review.
 */

import { parseHtml, readUnits } from './blocks.js';
import { diffUnits, toSnapshot, fromSnapshot } from './diff.js';

export const HLX_ADMIN = 'https://admin.hlx.page';
export const AEM_API = 'https://api.aem.live';

/** The DA document path: "/" is "/index", ".html" is dropped. */
export function docPath(path) {
  const clean = String(path || '/').replace(/\.html$/, '');
  return clean.endsWith('/') ? `${clean}index` : clean;
}

/** The public path: "/index" is "/", "/x/index" is "/x/". */
export function webPath(path) {
  return docPath(path).replace(/(^|\/)index$/, '$1');
}

export function pageInfo({
  org, site, path, branch = 'main',
}) {
  const ref = String(branch || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const doc = docPath(path);
  return {
    org,
    site,
    path: doc,
    webPath: webPath(doc),
    previewUrl: `https://${ref}--${site}--${org}.aem.page${webPath(doc)}`,
    liveUrl: `https://main--${site}--${org}.aem.live${webPath(doc)}`,
    editUrl: `https://da.live/canvas#/${org}/${site}${doc}`,
  };
}

async function adminPost(auth, token, page, api) {
  const p = page.path.toLowerCase();
  const urls = [
    `${HLX_ADMIN}/${api}/${page.org}/${page.site}/main${p}`,
    `${AEM_API}/${page.org}/sites/${page.site}/${api}${p}`,
  ];
  let last = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      last = await auth(urls[i], {
        method: 'POST',
        headers: { 'x-content-source-authorization': `Bearer ${token()}` },
      });
      if (last.status !== 404) break;
    } catch {
      last = null;
    }
  }
  return last;
}

function adminError(resp, action) {
  const status = resp?.status || 0;
  if (status === 401 || status === 403) return `You are not allowed to ${action} this page (${status}).`;
  return status ? `Could not ${action} the page (${status}).` : 'Could not reach AEM.';
}

/** Previews the page like the toolbar does, so the reviewer sees the current draft. */
export async function refreshPreview(auth, token, page) {
  const resp = await adminPost(auth, token, page, 'preview');
  if (!resp?.ok) return { ok: false, error: adminError(resp, 'preview') };
  let modified = '';
  try {
    modified = (await resp.json())?.preview?.lastModified || '';
  } catch {
    // The comparison still works, only without the freshness check.
  }
  return { ok: true, modified };
}

/** Previews, then publishes, with the author's own permissions. */
export async function publishPage(auth, token, page) {
  const preview = await adminPost(auth, token, page, 'preview');
  if (!preview?.ok) return { ok: false, error: adminError(preview, 'preview') };
  const live = await adminPost(auth, token, page, 'live');
  if (!live?.ok) return { ok: false, error: adminError(live, 'publish') };
  return { ok: true, url: page.liveUrl };
}

/** The page title a reviewer recognises: metadata Title, else the first H1. */
export function titleOf(units, fallback = '') {
  const meta = units.find((u) => u.kind === 'meta' && u.label.toLowerCase() === 'title');
  const h1 = units.find((u) => u.kind === 'heading' && u.level === 1);
  return meta?.text || h1?.text || fallback;
}

/**
 * Compares the preview with live and, when there is one, with the last review.
 * @param {{preview: string, live?: string|null}} versions .plain.html of each version
 * @param {object} [snapshot] the snapshot stored with the last review request
 * @param {Function} [Parser] DOMParser (tests pass linkedom's)
 */
export function compare(versions, snapshot, Parser) {
  const parse = (html) => readUnits(parseHtml(html, Parser));
  const units = parse(versions.preview);
  const live = versions.live ? parse(versions.live) : null;
  const current = toSnapshot(units);
  const result = {
    units,
    snapshot: current,
    firstVersion: !live,
    sinceLive: live ? diffUnits(live, units) : diffUnits([], units),
    sinceReview: null,
  };
  if (snapshot?.units) {
    // Compare like with like: the stored snapshot trims long text, so trim ours too.
    result.sinceReview = diffUnits(fromSnapshot(snapshot), fromSnapshot(current));
  }
  return result;
}
