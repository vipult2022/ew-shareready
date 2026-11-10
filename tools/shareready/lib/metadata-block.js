import { escapeHtml } from './dom.js';
import { fitText, normalize } from './measure.js';
import { PLATFORMS } from './platforms.js';
import { indexEntries } from './checks.js';
import { DEFAULT_IMAGE } from './extract.js';

export const FIELDS = [
  { name: 'title', label: 'Title', kind: 'text' },
  { name: 'description', label: 'Description', kind: 'text' },
  { name: 'image', label: 'Image', kind: 'image' },
  { name: 'image-alt', label: 'Image Alt', kind: 'text' },
];

const IDEAL_RATIO = 1.91;
const DESCRIPTION_MAX = 155;
const WEAK_ENDING = /[\s,;:–—|-]+(?:a|an|and|as|at|before|by|for|from|in|into|is|of|on|or|the|to|when|while|with|you|your)?$/i;
const SEPARATORS = [': ', ' – ', ' — ', ' | ', ' - '];

function join(value, suffix) {
  return value && suffix && suffix !== '""' ? `${value} ${suffix}` : value;
}

function titleFits(candidate, page) {
  const full = join(candidate, page.metaConfig['title:suffix']);
  const html = join(full, page.metaConfig['html-title:suffix']);
  return PLATFORMS.filter((p) => p.title)
    .every((p) => !fitText(p.source === 'html' ? html : full, p.title).truncated);
}

function tidyEnding(value) {
  let out = value;
  let prev;
  do {
    prev = out;
    out = out.replace(WEAK_ENDING, '');
  } while (out !== prev && out);
  return out;
}

const CLAUSE = /[,;]\s+|\s+(?:when|if|before|by|until|while|so|because|and|with|for|from)\s+/gi;

function clauseCuts(value) {
  const cuts = [];
  [...value.matchAll(CLAUSE)].forEach((m) => cuts.push(tidyEnding(value.slice(0, m.index))));
  return cuts;
}

function titleCandidates(base) {
  const pieces = new Set([base]);
  SEPARATORS.forEach((sep) => {
    const parts = base.split(sep);
    if (parts.length < 2) return;
    parts.forEach((part, i) => {
      pieces.add(part);
      if (i > 0) pieces.add(parts.slice(0, i).join(sep));
    });
  });
  const out = new Set();
  pieces.forEach((piece) => {
    out.add(tidyEnding(piece.trim()));
    clauseCuts(piece.trim()).forEach((cut) => out.add(cut));
  });
  return [...out].filter((c) => c.split(' ').length >= 3);
}

/**
 * Suggests a title that fits every platform: the current title if it fits, otherwise
 * the longest fitting phrase (cut at a separator or clause), otherwise a word-boundary cut.
 */
export function suggestTitle(page) {
  const base = normalize(page.title.value) || page.h1s[0] || page.headings[0]?.text || '';
  if (!base || titleFits(base, page)) return base;
  const best = titleCandidates(base)
    .filter((c) => titleFits(c, page))
    .sort((a, b) => b.length - a.length)[0];
  if (best) return best;
  const words = base.split(' ');
  let n = words.length - 1;
  while (n > 1) {
    const candidate = tidyEnding(words.slice(0, n).join(' '));
    if (candidate && titleFits(candidate, page)) return candidate;
    n -= 1;
  }
  return base;
}

function sentences(paragraph) {
  return normalize(paragraph).split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/);
}

function autoDescription(paragraph) {
  const words = normalize(paragraph).split(' ');
  return `${words.slice(0, 25).join(' ')}${words.length > 25 ? ' ...' : ''}`;
}

function describeParagraph(paragraph) {
  let out = '';
  sentences(paragraph).some((s) => {
    const next = out ? `${out} ${s}` : s;
    if (next.length > DESCRIPTION_MAX) return true;
    out = next;
    return out.length >= 120;
  });
  if (out) return out;
  const words = normalize(paragraph).split(' ');
  while (words.length && `${words.join(' ')}…`.length > DESCRIPTION_MAX) words.pop();
  return `${tidyEnding(words.join(' '))}…`;
}

/**
 * Suggests a description: keeps a good authored one, otherwise builds one from whole
 * sentences of the page's paragraphs, skipping text other pages already use.
 */
export function suggestDescription(page, index) {
  const taken = new Set(indexEntries(index, page.path)
    .map((e) => e.description.toLowerCase()).filter(Boolean));
  const current = normalize(page.description.value);
  const authored = ['metadata', 'bulk'].includes(page.description.source);
  if (authored && current.length >= 70 && current.length <= DESCRIPTION_MAX
    && !taken.has(current.toLowerCase())) {
    return current;
  }
  const title = normalize(page.title.value).toLowerCase();
  const candidates = page.paragraphs
    .filter((p) => p.split(' ').length >= 8)
    .filter((p) => !taken.has(autoDescription(p).toLowerCase()))
    .map(describeParagraph)
    .filter((d) => d.toLowerCase() !== title && !taken.has(d.toLowerCase()));
  return candidates.find((d) => d.length >= 100)
    || candidates.find((d) => d.length >= 50)
    || candidates[0]
    || current;
}

function imageScore(info) {
  if (!info?.ok) return Infinity;
  const ratio = info.width / info.height;
  let score = (Math.abs(ratio - IDEAL_RATIO) / IDEAL_RATIO) * 100;
  if (info.width < 1200) score += 15;
  if (info.width < 600) score += 100;
  return score;
}

function isSvg(url) {
  return /\.svg($|[?#])/i.test(url || '');
}

/**
 * Picks the page image that will make the best card: closest to 1.91:1 and at least
 * 1200px wide. Keeps the current image unless another one is clearly better.
 */
export function suggestImage(page, images = new Map()) {
  const current = page.image.source === 'default' || page.image.src === DEFAULT_IMAGE ? null : {
    src: page.image.src, url: page.og.image, alt: page.imageAlt.value,
  };
  const options = [current, ...page.images].filter((o) => o && !isSvg(o.url));
  let best = null;
  let bestScore = Infinity;
  options.forEach((o) => {
    const score = imageScore(images.get(o.url));
    if (score < bestScore - 0.5) {
      best = o;
      bestScore = score;
    }
  });
  return best || current;
}

/**
 * Proposes values for the four core fields, with before/after for review.
 */
export function buildProposal(page, { images, index } = {}) {
  const image = suggestImage(page, images);
  const sameImage = image && image.url === page.og.image;
  const alt = (image?.alt || (sameImage ? page.imageAlt.value : '')).trim();
  const after = {
    title: suggestTitle(page),
    description: suggestDescription(page, index),
    image: image?.src || '',
    'image-alt': alt,
  };
  const before = {
    title: page.title.value,
    description: page.description.value,
    image: page.image.source === 'default' ? '' : page.image.src,
    'image-alt': page.imageAlt.value,
  };
  const sources = {
    title: page.title.source,
    description: page.description.source,
    image: page.image.source,
    'image-alt': page.imageAlt.source,
  };
  const fields = FIELDS.map((f) => {
    const inBlock = page.rows.some((r) => r.name === f.name && r.value);
    const changed = !!after[f.name] && (after[f.name] !== before[f.name] || !inBlock);
    return {
      ...f,
      before: before[f.name],
      after: after[f.name],
      source: sources[f.name],
      imageUrl: f.name === 'image' ? image?.url : undefined,
      changed,
      missing: !after[f.name],
    };
  });
  return { fields, changed: fields.some((f) => f.changed) };
}

function cellHtml(field, value, alt) {
  if (field.kind === 'image') return `<p><img src="${escapeHtml(value)}" alt="${escapeHtml(alt || '')}"></p>`;
  return `<p>${escapeHtml(value)}</p>`;
}

/**
 * Merges the proposal into the existing Metadata rows. Title, Description, Image and
 * Image Alt come first (as in EW's Page panel); all other rows keep their order.
 */
export function mergeRows(page, proposal) {
  const alt = proposal.fields.find((f) => f.name === 'image-alt')?.after;
  const core = proposal.fields.map((field) => {
    const existing = page.rows.find((r) => r.name === field.name);
    if (field.changed) {
      return { label: existing?.label || field.label, html: cellHtml(field, field.after, alt) };
    }
    if (existing) return { label: existing.label, html: existing.html };
    return null;
  }).filter(Boolean);
  const coreNames = new Set(FIELDS.map((f) => f.name));
  const rest = page.rows.filter((r) => !coreNames.has(r.name))
    .map((r) => ({ label: r.label, html: r.html }));
  return [...core, ...rest];
}

/** DA editor table markup for a Metadata block. */
export function toTableHtml(rows) {
  const body = rows.map((r) => `<tr><td><p>${escapeHtml(r.label)}</p></td><td>${r.html}</td></tr>`).join('');
  return `<table><tbody><tr><td colspan="2"><p>metadata</p></td></tr>${body}</tbody></table>`;
}

/** Plain-text version for the clipboard fallback. */
export function toPlainText(rows, Parser = DOMParser) {
  return rows.map((r) => {
    const cell = new Parser().parseFromString(r.html, 'text/html');
    const value = normalize(cell.documentElement.textContent) || cell.querySelector('img')?.getAttribute('src') || '';
    return `${r.label}\t${value}`;
  }).join('\n');
}

/**
 * Writes the rows into a parsed EDS document as div.metadata (used by demo mode and tests).
 */
export function applyToDocument(doc, rows) {
  const block = doc.createElement('div');
  block.className = 'metadata';
  rows.forEach((r) => {
    const row = doc.createElement('div');
    const key = doc.createElement('div');
    const value = doc.createElement('div');
    key.textContent = r.label;
    value.innerHTML = r.html;
    row.append(key, value);
    block.append(row);
  });
  const main = doc.querySelector('main') || doc.body;
  const existing = main.querySelector('div.metadata');
  if (existing) {
    existing.replaceWith(block);
  } else {
    let section = main.lastElementChild;
    if (!section || section.tagName !== 'DIV') {
      section = doc.createElement('div');
      main.append(section);
    }
    section.append(block);
  }
  return doc;
}

/**
 * True when the selected editor HTML sits inside the page's Metadata table: the
 * selection is in a table and its text matches one of the Metadata cells.
 */
export function selectionInMetadata(selectionHtml, page, Parser = DOMParser) {
  if (!selectionHtml || !/<t[dh][\s>]/i.test(selectionHtml)) return false;
  const doc = new Parser().parseFromString(selectionHtml, 'text/html');
  const cells = page.rows.flatMap((r) => [r.label, r.value]).map((v) => normalize(v).toLowerCase());
  cells.push('metadata');
  // The editor serializes the selection with its parent table, so each selected cell is a <td>.
  const selected = [...doc.querySelectorAll('td, th')]
    .map((td) => normalize(td.textContent).toLowerCase())
    .filter(Boolean);
  if (!selected.length) return false;
  return selected.every((s) => cells.some((c) => c && c.includes(s)));
}
