/**
 * Copies Airtable attachments into the site's Document Authoring media folder before they are
 * inserted. Airtable's attachment links expire after a few hours, so a page must never point
 * at them. Names include a hash of the image, so inserting the same photo again reuses it.
 */

import { DA_ADMIN } from './config.js';

const DA_CONTENT = 'https://content.da.live';
const MAX_BYTES = 20 * 1024 * 1024;

export function slug(name) {
  const base = String(name || 'image').replace(/\.[a-z0-9]+$/i, '');
  return base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

function extension(name, type) {
  const fromName = String(name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
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
  const parts = String(folder || '/media/airtable').split('/').map((p) => p.trim()).filter(Boolean);
  const safe = parts.filter((p) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) && p !== '..');
  return `/${(safe.length ? safe : ['media', 'airtable']).join('/')}`;
}

/**
 * Returns a Map of Airtable URL → content.da.live URL. Images that cannot be copied are left
 * out of the map and listed in `failed`, so the caller can warn and keep the original link.
 */
export async function copyImages(attachments, {
  org, repo, token, folder, fetchImpl = fetch, onProgress = () => {},
}) {
  const copied = new Map();
  const failed = [];
  const dir = cleanFolder(folder);
  let done = 0;
  await Promise.all(attachments.map(async (att) => {
    try {
      const resp = await fetchImpl(att.url);
      if (!resp.ok) throw new Error(`download ${resp.status}`);
      const blob = await resp.blob();
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
