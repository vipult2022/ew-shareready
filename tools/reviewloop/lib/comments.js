/**
 * Ties reviewer comments to the page: text a reviewer quotes ("change “…” to …") is looked
 * up in the current draft, so the author sees where it is, or that it is gone (addressed).
 */

const QUOTES = /“([^”]{6,300})”|"([^"]{6,300})"|‘([^’]{6,300})’/g;

function norm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function quotes(text) {
  return [...String(text || '').matchAll(QUOTES)].map((m) => (m[1] || m[2] || m[3]).trim());
}

/**
 * @param {string} text comment text
 * @param {Array} units the draft's units (blocks.readUnits)
 * @returns {{quote: string, found: string[]}|null} the first quote and where it appears;
 *   found is empty when the quoted text is no longer on the page.
 */
export function locate(text, units = []) {
  const [quote] = quotes(text);
  if (!quote) return null;
  const q = norm(quote);
  const found = [...new Set(units
    .filter((u) => norm(u.text).includes(q) || (u.label && norm(`${u.label} ${u.text}`).includes(q)))
    .map((u) => (u.kind === 'meta' ? `${u.location} › ${u.label}` : u.location)))];
  return { quote, found };
}
