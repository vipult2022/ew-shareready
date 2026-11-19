/**
 * Design check: compares the page in the editor with the Figma design and lists what is
 * missing, so nothing a designer put in the mockup gets lost on the way to the page.
 * Works on the HTML EW shares with plugins (or the saved DA document) with plain string
 * parsing, so it runs the same in the panel and in tests.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decode(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (all, code) => {
    const lower = code.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return all;
  });
}

/** Text for comparing: case, quotes, dashes and spacing don't count. */
export function norm(text) {
  return decode(String(text || ''))
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\s\u00a0\u202f]+/g, ' ')
    .trim();
}

export function textOf(html) {
  return norm(String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decode(match[2] ?? match[3] ?? match[4] ?? '') : null;
}

export function linksOf(html) {
  const out = [];
  String(html || '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (all, attrs, inner) => {
    out.push({ href: attr(` ${attrs}`, 'href') || '', text: textOf(inner) });
    return all;
  });
  return out;
}

export function imagesOf(html) {
  const out = [];
  String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    out.push({ src: attr(tag, 'src') || '', alt: attr(tag, 'alt') || '' });
    return tag;
  });
  return out;
}

export const fileName = (url) => decodeURIComponent(String(url || '').split(/[?#]/)[0].split('/').pop() || '').toLowerCase();

/**
 * { found, total, score, groups: { texts, images, buttons }, missing: [item], notes: [text] }
 * `imageUrl(id)` is where each picture was copied in the site ('' when not copied yet).
 */
export function designCheck(model, html, { imageUrl = () => '' } = {}) {
  const text = textOf(html);
  const links = linksOf(html);
  const pictures = imagesOf(html);
  const groups = {
    texts: { found: 0, total: 0 },
    images: { found: 0, total: 0 },
    buttons: { found: 0, total: 0 },
  };
  const missing = [];
  const notes = [];
  const seen = new Set();
  (model.items || []).forEach((item) => {
    const key = item.kind === 'image' ? `i|${item.image}` : `${item.kind}|${norm(item.text)}`;
    if (seen.has(key)) return;
    seen.add(key);
    let ok = false;
    if (item.kind === 'image') {
      groups.images.total += 1;
      const name = fileName(imageUrl(item.image));
      const hit = name && pictures.find((p) => fileName(p.src) === name);
      ok = !!hit;
      if (hit && !hit.alt.trim()) notes.push(`An image has no alt text${item.name ? ` (“${item.name}”)` : ''}.`);
      if (ok) groups.images.found += 1;
    } else if (item.kind === 'button') {
      groups.buttons.total += 1;
      const want = norm(item.text);
      const hit = links.find((l) => l.text === want) || links.find((l) => l.text.includes(want));
      ok = !!hit;
      if (hit && (!hit.href || hit.href === '#')) notes.push(`The “${item.text}” button has no link yet.`);
      if (ok) groups.buttons.found += 1;
    } else {
      groups.texts.total += 1;
      ok = text.includes(norm(item.text));
      if (ok) groups.texts.found += 1;
    }
    if (!ok) missing.push(item);
  });
  const total = groups.texts.total + groups.images.total + groups.buttons.total;
  const found = groups.texts.found + groups.images.found + groups.buttons.found;
  return {
    found,
    total,
    score: total ? Math.round((found / total) * 100) : 100,
    groups,
    missing,
    notes,
  };
}
