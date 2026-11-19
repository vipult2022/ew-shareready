/**
 * Copies the design's pictures into the site's Document Authoring media folder, so the page
 * never points at the worker (handoffs expire after 30 days). Names include a hash of the
 * picture, so sending the same design again reuses the files.
 */

import { DA_ADMIN } from './config.js';

const DA_CONTENT = 'https://content.da.live';
const MAX_BYTES = 20 * 1024 * 1024;

export function slug(name) {
  const base = String(name || 'image').replace(/\.(avif|gif|jpe?g|png|svg|webp)$/i, '');
  return base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'image';
}

function extension(type) {
  return ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[type] || 'jpg';
}

async function shortHash(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function cleanFolder(folder) {
  const parts = String(folder || '/media/figma').split('/').map((p) => p.trim()).filter(Boolean);
  const safe = parts.filter((p) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) && p !== '..');
  return `/${(safe.length ? safe : ['media', 'figma']).join('/')}`;
}

/**
 * `pictures` is [{ image, name }] (one per picture id). `download(image)` returns a Blob.
 * Returns a Map of picture id → content.da.live URL, plus the ones that failed.
 */
export async function copyImages(pictures, {
  org, repo, token, folder, prefix = '', download, fetchImpl = fetch, onProgress = () => {},
}) {
  const copied = new Map();
  const failed = [];
  const dir = cleanFolder(folder);
  const unique = [...new Map(pictures.map((p) => [p.image, p])).values()];
  let done = 0;
  await Promise.all(unique.map(async (pic) => {
    try {
      const blob = await download(pic.image);
      if (!blob || !blob.size) throw new Error('empty image');
      if (blob.size > MAX_BYTES) throw new Error('too large');
      const label = slug([prefix, pic.name].filter(Boolean).join(' '));
      const name = `${label}-${await shortHash(await blob.arrayBuffer())}.${extension(blob.type)}`;
      const path = `/${org}/${repo}${dir}/${name}`;
      const form = new FormData();
      form.append('data', blob, name);
      const put = await fetchImpl(`${DA_ADMIN}/source${path}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      copied.set(pic.image, `${DA_CONTENT}${path}`);
    } catch (error) {
      failed.push({ ...pic, error: error.message });
    } finally {
      done += 1;
      onProgress(done, unique.length);
    }
  }));
  return { copied, failed };
}
