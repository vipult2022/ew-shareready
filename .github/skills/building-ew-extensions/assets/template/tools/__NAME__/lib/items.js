/**
 * The one item shape the panel works with, whatever the source:
 *   { id, title, summary, url }
 * Map your service's response to this shape in the worker (or here), never in the panel.
 */

/** An absolute https URL, or '' for anything else (javascript:, data:, http:, junk). */
export function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const title = String(raw.title ?? '').trim();
  if (!id || !title) return null;
  return {
    id,
    title: title.slice(0, 300),
    summary: String(raw.summary ?? '').trim().slice(0, 2000),
    url: safeUrl(raw.url),
  };
}

export function normalizeItems(list) {
  return (Array.isArray(list) ? list : []).map(normalizeItem).filter(Boolean);
}

export function filterItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => `${item.title} ${item.summary}`.toLowerCase().includes(q));
}
