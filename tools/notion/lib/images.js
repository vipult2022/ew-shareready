/**
 * Copies Notion images into the site's Document Authoring media folder before they are
 * inserted. Notion's file links expire after an hour, so a page must never point at them.
 * Names include a hash of the image, so inserting the same picture again reuses it.
 * Images the browser cannot download (no CORS) come through the worker's /file route.
 */

import { DA_ADMIN } from './config.js';

const DA_CONTENT = 'https://content.da.live';
const MAX_BYTES = 20 * 1024 * 1024;

export function slug(name) {
  const base = String(name || 'image').replace(/\.(avif|gif|jpe?g|png|svg|webp)$/i, '');
  return base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

function extension(name, type) {
  const fromName = String(name || '').match(/\.(avif|gif|jpe?g|png|svg|webp)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  return ({
    'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  })[type] || 'jpg';
}

async function shortHash(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanFolder(folder) {
  const parts = String(folder || '/media/notion').split('/').map((p) => p.trim()).filter(Boolean);
  const safe = parts.filter((p) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) && p !== '..');
  return `/${(safe.length ? safe : ['media', 'notion']).join('/')}`;
}

async function download(url, fetchImpl, fallback) {
  try {
    const resp = await fetchImpl(url);
    if (resp.ok) return await resp.blob();
    if (!fallback) throw new Error(`download ${resp.status}`);
  } catch (error) {
    if (!fallback) throw error;
  }
  return fallback(url);
}

/**
 * Returns a Map of Notion URL → content.da.live URL. Images that cannot be copied are left
 * out of the map and listed in `failed`, so the caller can warn.
 */
export async function copyImages(attachments, {
  org, repo, token, folder, fetchImpl = fetch, fallback = null, onProgress = () => {},
}) {
  const copied = new Map();
  const failed = [];
  const dir = cleanFolder(folder);
  let done = 0;
  await Promise.all(attachments.map(async (att) => {
    try {
      const blob = await download(att.url, fetchImpl, fallback);
      if (blob.size > MAX_BYTES) throw new Error('too large');
      const name = `${slug(att.name)}-${await shortHash(await blob.arrayBuffer())}.${extension(att.name, blob.type)}`;
      const path = `/${org}/${repo}${dir}/${name}`;
      const form = new FormData();
      form.append('data', blob, name);
      const put = await fetchImpl(`${DA_ADMIN}/source${path}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      copied.set(att.url, `${DA_CONTENT}${path}`);
    } catch (error) {
      failed.push({ ...att, error: error.message });
    } finally {
      done += 1;
      onProgress(done, attachments.length);
    }
  }));
  return { copied, failed };
}
