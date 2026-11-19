/**
 * Figma worker: the inbox between the Figma plugin and Experience Workspace. Designers send
 * a frame from Figma (layers, pictures and a thumbnail); authors open it in the EW panel and
 * mark it built, which the designer sees in the plugin. Handoffs live in Workers KV for
 * 30 days. Figma's API is not used at all, so its rate limits never apply.
 *
 * Figma plugin (team key in "Authorization: Bearer", any origin):
 *   POST /send       store a handoff                      { org, site, handoff, images, thumbnail }
 *   POST /sent       the site's handoffs and their status { org, site }
 *
 * Experience Workspace (author's IMS token, body also has the open page's path):
 *   POST /handoffs   the site's handoffs                  { org, site, path }
 *   POST /handoff    one handoff with its layer tree      { …, id }
 *   POST /image      one picture of a handoff             { …, id, image }
 *   POST /status     mark built (or new again)            { …, id, status, url }
 *
 *   GET  /status     whether the worker is set up (no token needed)
 */

import {
  HttpError, allowedOrigin, corsHeaders, json, readBody, validatePage, validateSite,
  authorize, checkKey, list,
} from './http.js';

const TTL = 30 * 24 * 60 * 60;
const MAX_SEND = 15 * 1024 * 1024;
const MAX_TREE = 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 40;
const MAX_HANDOFFS = 100;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STATUSES = ['new', 'updated', 'built'];
const TYPES = { jpg: 'image/jpeg', png: 'image/png' };

const handoffKey = ({ org, site }, id) => `h:${org}/${site}/${id}`;
const imageKey = ({ org, site }, id, picture) => `i:${org}/${site}/${id}/${picture}`;

function store(env) {
  if (!env.HANDOFFS) {
    throw new HttpError(500, 'The worker is not set up yet: bind a KV namespace as HANDOFFS.', { setup: true });
  }
  return env.HANDOFFS;
}

function clip(value, max = 200) {
  if (typeof value !== 'string') return '';
  return [...value].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, max);
}

function cleanId(value, what = 'design') {
  const id = String(value || '').toLowerCase();
  if (!ID.test(id)) throw new HttpError(400, `Choose a ${what}.`);
  return id;
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

/** Base64 picture → bytes, only JPEG or PNG (checked by their first bytes). */
export function decodeImage(data) {
  if (typeof data !== 'string' || !data) throw new HttpError(400, 'A picture is missing.');
  let bytes;
  try {
    const raw = atob(data.replace(/^data:image\/[a-z]+;base64,/, ''));
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'A picture is not valid.');
  }
  if (bytes.byteLength > MAX_IMAGE) throw new HttpError(413, 'A picture is larger than 5 MB. Export it smaller.');
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: TYPES.jpg };
  const png = [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
  if (png) return { bytes, type: TYPES.png };
  throw new HttpError(415, 'Pictures must be JPEG or PNG.');
}

/** The small part of a handoff kept as KV metadata, so the inbox lists without reads. */
function summary(h) {
  return {
    id: h.id,
    name: clip(h.name, 80),
    file: clip(h.file, 60),
    page: clip(h.page, 60),
    sender: clip(h.sender, 60),
    path: clip(h.path, 120),
    sent: h.sent,
    status: h.status,
    url: clip(h.url, 240),
    updated: h.updated || '',
    thumbnail: h.thumbnail ? 'thumbnail' : '',
  };
}

async function inbox(site, env) {
  const kv = store(env);
  const { keys } = await kv.list({ prefix: `h:${site.org}/${site.site}/`, limit: MAX_HANDOFFS });
  return keys.map((k) => k.metadata).filter((m) => m && m.id)
    .sort((a, b) => String(b.updated || b.sent).localeCompare(String(a.updated || a.sent)));
}

async function load(site, id, env) {
  const found = await store(env).get(handoffKey(site, cleanId(id)), 'json');
  if (!found) throw new HttpError(404, 'That design is no longer in the inbox. Ask the designer to send it again.');
  return found;
}

async function save(site, handoff, env) {
  const meta = summary(handoff);
  await store(env).put(handoffKey(site, handoff.id), JSON.stringify(handoff), {
    expirationTtl: TTL, metadata: meta,
  });
  return meta;
}

/** A stable id per Figma file and frame, so sending a frame again updates it. */
async function handoffId(site, h) {
  const text = `${site.org}/${site.site}|${clip(h.fileKey || h.file, 200)}|${clip(h.frame || h.name, 100)}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const slug = clip(h.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design';
  const tail = [...new Uint8Array(hash)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${tail}`;
}

async function send(body, env, site) {
  const h = body.handoff;
  if (!h || typeof h !== 'object' || !h.tree || typeof h.tree !== 'object') {
    throw new HttpError(400, 'Select a frame to send.');
  }
  const tree = JSON.stringify(h.tree);
  if (tree.length > MAX_TREE) throw new HttpError(413, 'This frame has too many layers. Send a smaller frame.');
  const images = body.images && typeof body.images === 'object' ? Object.entries(body.images) : [];
  if (images.length > MAX_IMAGES) throw new HttpError(413, `Send at most ${MAX_IMAGES} pictures at a time.`);
  const decoded = images.map(([key, img]) => ({
    key: cleanId(key, 'picture'), name: clip(img?.name, 120), ...decodeImage(img?.data),
  }));
  if (body.thumbnail) decoded.push({ key: 'thumbnail', name: 'Thumbnail', ...decodeImage(body.thumbnail) });

  const id = await handoffId(site, h);
  const previous = await store(env).get(handoffKey(site, id), 'json');
  const now = new Date().toISOString();
  const handoff = {
    id,
    name: clip(h.name, 120) || 'Untitled frame',
    file: clip(h.file, 120),
    fileKey: clip(h.fileKey, 64),
    frame: clip(h.frame, 64),
    page: clip(h.page, 120),
    sender: clip(h.sender, 80),
    note: clip(h.note, 1000),
    path: clip(h.path, 200),
    width: Number(h.width) || 0,
    height: Number(h.height) || 0,
    skipped: Number(h.skipped) || 0,
    sent: now,
    status: previous ? 'updated' : 'new',
    url: previous?.url || '',
    updated: '',
    thumbnail: body.thumbnail ? 'thumbnail' : '',
    images: decoded.filter((d) => d.key !== 'thumbnail').map((d) => ({ id: d.key, name: d.name })),
    tree: JSON.parse(tree),
  };
  const kv = store(env);
  await Promise.all(decoded.map((d) => kv.put(imageKey(site, id, d.key), d.bytes, {
    expirationTtl: TTL, metadata: { type: d.type },
  })));
  const meta = await save(site, handoff, env);
  return { ok: true, handoff: meta };
}

const panelRoutes = {
  async handoffs(body, env, site) {
    return { handoffs: await inbox(site, env) };
  },
  async handoff(body, env, site) {
    return { handoff: await load(site, body.id, env) };
  },
  async status(body, env, site) {
    const handoff = await load(site, body.id, env);
    const status = String(body.status || '');
    if (!STATUSES.includes(status)) throw new HttpError(400, 'That status is not valid.');
    if (body.url && !siteLink(body.url, { org: site.org, site: site.site })) {
      throw new HttpError(400, 'Only links to pages of this site can be saved.');
    }
    Object.assign(handoff, {
      status, url: body.url ? clip(body.url, 240) : handoff.url, updated: new Date().toISOString(),
    });
    return { ok: true, handoff: await save(site, handoff, env) };
  },
};

async function image(body, env, site, origin) {
  const id = cleanId(body.id);
  const key = cleanId(body.image, 'picture');
  const { value, metadata } = await store(env).getWithMetadata(imageKey(site, id, key), 'arrayBuffer');
  if (!value) throw new HttpError(404, 'That picture is no longer in the inbox. Ask the designer to send the design again.');
  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': metadata?.type || TYPES.jpg, 'Cache-Control': 'no-store', ...corsHeaders(origin),
    },
  });
}

const PLUGIN = ['send', 'sent'];
const PANEL = ['handoffs', 'handoff', 'image', 'status'];

export async function handle(request, env = {}, now = Date.now()) {
  const route = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '');
  const plugin = PLUGIN.includes(route);
  const origin = plugin ? '*' : allowedOrigin(request.headers.get('Origin'), env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
  }
  try {
    if (request.method === 'GET' && route === 'status') {
      return json({
        ok: true,
        service: 'figma',
        configured: !!env.HANDOFF_KEY && !!env.HANDOFFS && list(env.ALLOWED_ORGS).length > 0,
      }, 200, origin || '*');
    }
    if (request.method !== 'POST' || !(plugin || PANEL.includes(route))) throw new HttpError(404, 'Not found.');
    if (plugin) {
      const body = await readBody(request, route === 'send' ? MAX_SEND : undefined);
      const site = validateSite(body);
      await checkKey(request, site, env, now);
      if (route === 'send') return json(await send(body, env, site), 200, origin);
      return json({ handoffs: await inbox(site, env) }, 200, origin);
    }
    if (request.headers.get('Origin') && !origin) {
      throw new HttpError(403, 'This site may not use the worker. Add it to ALLOWED_ORIGINS.');
    }
    const body = await readBody(request);
    const page = validatePage(body);
    await authorize(request, page, env, now);
    if (route === 'image') return await image(body, env, page, origin);
    return json(await panelRoutes[route](body, env, page), 200, origin);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, code: error.extra?.setup ? 'setup' : '' }, error.status, origin);
    }
    return json({ error: 'Something went wrong in the Figma worker.' }, 500, origin);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
