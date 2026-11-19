/**
 * Reads the layer tree the Figma plugin sends (plugin/code.js) and works out what an author
 * would build from it: sections in reading order, headings by font size, buttons, images,
 * and a suggested block for each section.
 *
 * Layer tree nodes:
 *   { type: 'TEXT', id, name, x, y, w, h, text, size, link }
 *   { type: 'IMAGE', id, name, x, y, w, h, image }              an exported picture
 *   { type: 'FRAME', id, name, x, y, w, h, layout, image, imageName, filled, children }
 *     layout is HORIZONTAL, VERTICAL or NONE; image is a background picture.
 *
 * Designers can force a block by naming a frame after it: "Hero", "Cards", "Columns",
 * "Accordion" (or "FAQ"), "Table" or "Text". Otherwise:
 *   first section with the main heading and a picture   → Hero
 *   a row or grid of similar frames                     → Cards
 *   2 to 4 different frames side by side                → Columns
 *   everything else                                     → default content ("Text")
 */

const HINTS = [
  [/^hero\b/i, 'Hero'],
  [/^cards?\b/i, 'Cards'],
  [/^columns?\b/i, 'Columns'],
  [/^(accordion|faqs?)\b/i, 'Accordion'],
  [/^table\b/i, 'Table'],
  [/^(text|content|default)\b/i, 'Text'],
];
const BUTTON_NAME = /\b(button|btn|cta)\b/i;
const GENERIC_NAME = /^(rectangle|image|img|frame|group|vector|ellipse|photo|picture|pic|layer|mask|bg|background|untitled|component|instance)?([\s_-]*(\d+|copy))*$/i;
const ROW_TOLERANCE = 12;

const visible = (n) => !!n && n.visible !== false;
const kids = (n) => (n?.children || []).filter(visible);
export const clean = (text) => String(text ?? '').replace(/[\u2028\u2029]/g, '\n').replace(/[ \t]+/g, ' ').trim();

/** A layer name that says what the picture shows, or '' for "Rectangle 12" and friends. */
export function altFromName(name) {
  const text = clean(name).replace(/\.(avif|gif|jpe?g|png|svg|webp)$/i, '').replace(/[_-]+/g, ' ').trim();
  if (!text || GENERIC_NAME.test(text) || text.length < 4) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function texts(node, out = []) {
  if (!visible(node)) return out;
  if (node.type === 'TEXT' && clean(node.text)) out.push(node);
  kids(node).forEach((c) => texts(c, out));
  return out;
}

function images(node, out = []) {
  if (!visible(node)) return out;
  if (node.image) out.push(node);
  kids(node).forEach((c) => images(c, out));
  return out;
}

/** Sizes become heading levels: the body size is the one most text is set in. */
export function headingScale(root) {
  const all = texts(root);
  const weight = new Map();
  all.forEach((t) => weight.set(t.size, (weight.get(t.size) || 0) + clean(t.text).length));
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 16;
  const sizes = [...new Set(all.map((t) => t.size))]
    .filter((s) => s >= body * 1.2)
    .sort((a, b) => b - a);
  return { body, sizes };
}

/** A small filled frame with one short label, or a frame named like a button. */
export function isButton(node) {
  if (!node || node.type !== 'FRAME' || node.image) return false;
  const inner = texts(node);
  if (inner.length !== 1 || images(node).length) return false;
  const words = clean(inner[0].text).split(/\s+/).length;
  if (BUTTON_NAME.test(node.name || '')) return words <= 8;
  return !!node.filled && node.h <= 80 && node.w <= 420 && words <= 6;
}

/** Children in reading order: rows top to bottom, left to right within a row. */
export function ordered(node) {
  const list = kids(node).slice();
  if (node.layout === 'HORIZONTAL') return list.sort((a, b) => a.x - b.x);
  if (node.layout === 'VERTICAL') return list.sort((a, b) => a.y - b.y);
  return list.sort((a, b) => (Math.abs(a.y - b.y) <= ROW_TOLERANCE ? a.x - b.x : a.y - b.y));
}

function sideBySide(list) {
  if (list.length < 2) return false;
  const sorted = list.slice().sort((a, b) => a.x - b.x);
  return sorted.every((n, i) => {
    if (i === 0) return true;
    const prev = sorted[i - 1];
    const overlapY = Math.min(prev.y + prev.h, n.y + n.h) - Math.max(prev.y, n.y);
    return n.x >= prev.x + prev.w - 4 && overlapY > Math.min(prev.h, n.h) * 0.3;
  });
}

function signature(node) {
  return `${images(node).length > 0 ? 'i' : ''}${Math.min(texts(node).length, 4)}`;
}

/** The similar frames inside a section that read as cards, if there are any. */
function cardSet(node, depth = 0) {
  if (!node || node.type !== 'FRAME' || depth > 2) return null;
  const list = ordered(node).filter((n) => n.type === 'FRAME' && !isButton(n));
  if (list.length >= 2) {
    const sig = signature(list[0]);
    const same = list.every((n) => signature(n) === sig);
    const even = list.every((n) => Math.abs(n.w - list[0].w) <= Math.max(24, list[0].w * 0.15));
    const enough = list.length >= 3 || images(list[0]).length > 0;
    if (same && even && enough && texts(list[0]).length > 0) return list;
  }
  return ordered(node).reduce((found, child) => found || cardSet(child, depth + 1), null);
}

/** 2 to 4 different frames (or pictures) side by side, if the section has them. */
function columnSet(node, depth = 0) {
  if (!node || node.type !== 'FRAME' || depth > 2) return null;
  const list = ordered(node);
  if (list.length >= 2 && list.length <= 4
    && (node.layout === 'HORIZONTAL' || sideBySide(list))
    && list.every((n) => (n.type === 'FRAME' && !isButton(n)) || n.type === 'IMAGE')) return list;
  return ordered(node).reduce((found, child) => found || columnSet(child, depth + 1), null);
}

function hintFor(name) {
  const hit = HINTS.find(([re]) => re.test(clean(name)));
  return hit ? hit[1] : '';
}

/**
 * The reading-order content of a node, leaving out nodes in `skip`:
 *   { kind: 'heading', level, text } | { kind: 'text', text, link }
 *   | { kind: 'button', text, link }
 *   | { kind: 'image', image, alt, name, w, h }
 */
export function contentOf(node, scale, ctx, skip = new Set()) {
  const out = [];
  const walk = (n) => {
    if (!visible(n) || skip.has(n)) return;
    if (n.type === 'TEXT') {
      const text = clean(n.text);
      if (!text) return;
      const rank = scale.sizes.indexOf(n.size);
      if (rank >= 0) {
        let level = Math.min(rank + 1, 3);
        if (level === 1 && ctx.h1Used) level = 2;
        if (level === 1) ctx.h1Used = true;
        out.push({
          kind: 'heading', level, text, id: n.id,
        });
      } else {
        out.push({
          kind: 'text', text, link: n.link || '', id: n.id,
        });
      }
      return;
    }
    if (isButton(n)) {
      const label = texts(n)[0];
      out.push({
        kind: 'button', text: clean(label.text), link: label.link || n.link || '', id: n.id,
      });
      return;
    }
    if (n.image) {
      // A frame's background picture has no layer name of its own, only the frame's.
      const picName = n.type === 'FRAME' ? clean(n.imageName) : clean(n.name);
      out.push({
        kind: 'image', image: n.image, alt: altFromName(picName), name: picName, w: n.w, h: n.h, id: n.id,
      });
    }
    if (n.type === 'FRAME') ordered(n).forEach(walk);
  };
  walk(node);
  return out;
}

function accordion(node, scale, ctx) {
  const frames = ordered(node).filter((n) => n.type === 'FRAME' && texts(n).length >= 2);
  if (frames.length >= 2) {
    const lead = contentOf(node, scale, ctx, new Set(frames));
    const rows = frames.map((f) => {
      const [first, ...rest] = contentOf(f, scale, { h1Used: true });
      return [[{ ...first, kind: 'text' }], rest];
    });
    return { lead, rows };
  }
  const items = contentOf(node, scale, ctx);
  const start = items.findIndex((it) => it.kind !== 'heading');
  const lead = start > 0 ? items.slice(0, start) : [];
  const body = start >= 0 ? items.slice(start) : [];
  const rows = [];
  for (let i = 0; i < body.length; i += 2) {
    rows.push([[{ ...body[i], kind: 'text' }], body[i + 1] ? [body[i + 1]] : []]);
  }
  return { lead, rows };
}

function table(node) {
  return ordered(node).filter((n) => n.type === 'FRAME')
    .map((row) => ordered(row).map((cell) => texts(cell).map((t) => ({ kind: 'text', text: clean(t.text), id: t.id }))));
}

/** One design band → { name, block, lead, rows } or { name, block: 'Text', items }. */
function section(node, first, scale, ctx) {
  const name = clean(node.name) || 'Section';
  const hint = hintFor(node.name);
  const base = { name, id: node.id };

  if (hint === 'Accordion') {
    const { lead, rows } = accordion(node, scale, ctx);
    if (rows.length) {
      return {
        ...base, block: 'Accordion', lead, rows,
      };
    }
  }
  if (hint === 'Table') {
    const rows = table(node);
    if (rows.length) {
      return {
        ...base, block: 'Table', lead: [], rows,
      };
    }
  }
  if (hint === 'Text') return { ...base, block: 'Text', items: contentOf(node, scale, ctx) };

  const hasH1 = !ctx.h1Used && texts(node).some((t) => t.size === scale.sizes[0]);
  const pictures = images(node).length;
  if (hint === 'Hero' || (!hint && first && hasH1 && pictures >= 1 && pictures <= 2)) {
    return { ...base, block: 'Hero', rows: [[contentOf(node, scale, ctx)]] };
  }

  if (!hint || hint === 'Cards') {
    const cards = cardSet(node);
    if (cards) {
      const lead = contentOf(node, scale, ctx, new Set(cards));
      const rows = cards.map((card) => {
        const all = contentOf(card, scale, ctx);
        const pics = all.filter((it) => it.kind === 'image');
        const rest = all.filter((it) => it.kind !== 'image');
        return pics.length ? [pics.slice(0, 1), [...pics.slice(1), ...rest]] : [rest];
      });
      return {
        ...base, block: 'Cards', lead, rows,
      };
    }
  }

  if (!hint || hint === 'Columns') {
    const cols = columnSet(node);
    if (cols) {
      const lead = contentOf(node, scale, ctx, new Set(cols));
      const rows = [cols.map((c) => contentOf(c, scale, ctx))];
      return {
        ...base, block: 'Columns', lead, rows,
      };
    }
  }

  return { ...base, block: 'Text', items: contentOf(node, scale, ctx) };
}

/** Peels off wrappers that hold a single frame, so sections are the real bands. */
function pageRoot(tree) {
  let root = tree;
  while (root && kids(root).length === 1 && kids(root)[0].type === 'FRAME' && !root.image) [root] = kids(root);
  return root;
}

/** Every item of a section in order: lead, then block cells, or the default content. */
export const sectionItems = (s) => [
  ...(s.lead || []), ...(s.items || []), ...(s.rows || []).flat(2),
];

const EMPTY_STATS = {
  texts: 0, images: 0, buttons: 0, sections: 0,
};

/** The whole handoff: { title, description, sections, items, warnings, stats }. */
export function analyze(handoff) {
  const tree = handoff?.tree;
  if (!tree) {
    return {
      title: '', description: '', sections: [], items: [], warnings: [], stats: { ...EMPTY_STATS },
    };
  }
  const root = pageRoot(tree);
  const scale = headingScale(root);
  const ctx = { h1Used: false };
  const sections = [];
  let loose = [];
  const flush = () => {
    if (loose.length) sections.push({ name: 'Text', block: 'Text', items: loose });
    loose = [];
  };
  ordered(root).forEach((node) => {
    if (node.type !== 'FRAME' || isButton(node)) {
      loose.push(...contentOf(node, scale, ctx));
      return;
    }
    flush();
    const s = section(node, sections.length === 0, scale, ctx);
    if (sectionItems(s).length) sections.push(s);
  });
  flush();

  const items = sections.flatMap(sectionItems);
  const h1 = items.findIndex((it) => it.kind === 'heading' && it.level === 1);
  const title = items[h1]?.text || items.find((it) => it.kind === 'heading')?.text || clean(handoff.name);
  const description = items.slice(h1 + 1).find((it) => it.kind === 'text' && it.text.length >= 40)?.text || '';

  const warnings = [];
  const unlinked = items.filter((it) => it.kind === 'button' && !it.link);
  if (unlinked.length) {
    warnings.push({ kind: 'link', text: `${unlinked.length} button${unlinked.length === 1 ? ' has' : 's have'} no link in Figma: ${unlinked.map((b) => `“${b.text}”`).join(', ')}.` });
  }
  const noAlt = items.filter((it) => it.kind === 'image' && !it.alt);
  if (noAlt.length) {
    warnings.push({ kind: 'alt', text: `${noAlt.length} image${noAlt.length === 1 ? ' needs' : 's need'} alt text: the layer name${noAlt.length === 1 ? ' does' : 's do'} not describe ${noAlt.length === 1 ? 'it' : 'them'}.` });
  }
  if (h1 < 0) warnings.push({ kind: 'h1', text: 'No main heading: no text is clearly larger than the rest.' });
  if (handoff.skipped > 0) {
    warnings.push({ kind: 'skipped', text: `${handoff.skipped} vector or icon layer${handoff.skipped === 1 ? ' was' : 's were'} left out.` });
  }

  return {
    title,
    description,
    sections,
    items,
    warnings,
    stats: {
      texts: items.filter((it) => it.kind === 'heading' || it.kind === 'text').length,
      images: items.filter((it) => it.kind === 'image').length,
      buttons: items.filter((it) => it.kind === 'button').length,
      sections: sections.length,
    },
  };
}
