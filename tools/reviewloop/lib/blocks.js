/**
 * Turns an Edge Delivery page (.plain.html or a DA source document) into an ordered
 * list of comparable units: headings, paragraphs, list items, images and metadata rows,
 * each with a human-readable location such as "Columns › Earn more".
 */

const ELEMENT = 1;
const TEXT_TAGS = new Set(['P', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const LIST_TAGS = new Set(['UL', 'OL']);
const META_BLOCKS = { metadata: 'Page metadata', 'section-metadata': 'Section settings' };

export function parseHtml(html, Parser = DOMParser) {
  const source = String(html || '');
  // .plain.html is a bare list of sections; give it a body so every parser agrees.
  const wrapped = /<body[\s>]/i.test(source) ? source : `<html><body>${source}</body></html>`;
  return new Parser().parseFromString(wrapped, 'text/html');
}

export function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function shorten(text, max = 48) {
  const t = clean(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function elements(el) {
  return [...(el?.childNodes || [])].filter((n) => n.nodeType === ELEMENT);
}

/** Title-cases a block class: "cards-wide" → "Cards wide". */
export function blockTitle(className) {
  const name = String(className || '').replace(/-/g, ' ').trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Block';
}

/**
 * A stable key for an image. Published media is content-addressed ("./media_<hash>.jpg"),
 * so the hash identifies the picture. Other URLs lose their query string.
 */
export function imageKey(src) {
  const value = String(src || '');
  const media = value.match(/media_([0-9a-f]{20,})/i);
  if (media) return `media_${media[1].toLowerCase()}`;
  return value.split(/[?#]/)[0];
}

function linksOf(el) {
  return [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
}

function imageUnit(img, location) {
  return {
    kind: 'image',
    location,
    text: clean(img.getAttribute('alt')),
    src: imageKey(img.getAttribute('src')),
  };
}

function textUnit(el, kind, location) {
  const unit = { kind, location, text: clean(el.textContent) };
  if (kind === 'heading') unit.level = Number(el.tagName[1]);
  const links = linksOf(el);
  if (links.length) unit.links = links;
  return unit;
}

/** Location for default content: the heading it sits under, or "Top of page". */
function contentLocation(state) {
  if (!state.heading || state.headingLevel === 1) return 'Top of page';
  return `“${shorten(state.heading, 40)}”`;
}

function headingLocation(level) {
  return level === 1 ? 'Page title (H1)' : `Heading (H${level})`;
}

/** Reads one element of content (default content or inside a block cell). */
function readElement(el, units, locate, state) {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    state.heading = clean(el.textContent);
    state.headingLevel = level;
    units.push(textUnit(el, 'heading', state.inBlock ? locate() : headingLocation(level)));
    return;
  }
  if (tag === 'PICTURE' || tag === 'IMG') {
    const img = tag === 'IMG' ? el : el.querySelector('img');
    if (img) units.push(imageUnit(img, locate()));
    return;
  }
  if (TEXT_TAGS.has(tag)) {
    el.querySelectorAll('img').forEach((img) => units.push(imageUnit(img, locate())));
    if (clean(el.textContent)) units.push(textUnit(el, 'text', locate()));
    return;
  }
  if (LIST_TAGS.has(tag)) {
    elements(el).filter((li) => li.tagName === 'LI')
      .forEach((li) => units.push(textUnit(li, 'list', locate())));
    return;
  }
  if (tag === 'TABLE') {
    el.querySelectorAll('tr').forEach((tr) => {
      if (clean(tr.textContent)) units.push(textUnit(tr, 'text', locate()));
    });
    return;
  }
  // Wrappers without meaning of their own (plain divs, spans): read what is inside.
  const kids = elements(el);
  if (kids.length) {
    kids.forEach((kid) => readElement(kid, units, locate, state));
  } else if (clean(el.textContent)) {
    units.push(textUnit(el, 'text', locate()));
  }
}

function readMetaBlock(block, location, units) {
  elements(block).forEach((row) => {
    const [keyCell, valueCell] = elements(row);
    const label = clean(keyCell?.textContent);
    if (!label || !valueCell) return;
    const img = valueCell.querySelector('img');
    units.push({
      kind: 'meta',
      location,
      label,
      text: img ? clean(img.getAttribute('alt')) : clean(valueCell.textContent),
      ...(img ? { src: imageKey(img.getAttribute('src')) } : {}),
    });
  });
}

function readBlock(block, units) {
  const name = (block.getAttribute('class') || '').split(/\s+/)[0];
  if (META_BLOCKS[name]) {
    readMetaBlock(block, META_BLOCKS[name], units);
    return;
  }
  const title = blockTitle(name);
  const rows = elements(block);
  rows.forEach((row, r) => {
    const cells = elements(row);
    cells.forEach((cell, c) => {
      const state = { inBlock: true };
      let where = '';
      if (rows.length > 1) where = `row ${r + 1}`;
      else if (cells.length > 1) where = `item ${c + 1}`;
      const locate = () => {
        const inner = state.heading ? shorten(state.heading, 32) : where;
        return inner ? `${title} › ${inner}` : title;
      };
      const kids = elements(cell);
      if (!kids.length) {
        if (clean(cell.textContent)) units.push(textUnit(cell, 'text', locate()));
        return;
      }
      kids.forEach((kid) => readElement(kid, units, locate, state));
    });
  });
}

function sectionsOf(doc) {
  const root = doc.querySelector('main') || doc.body || doc;
  const divs = elements(root).filter((el) => el.tagName === 'DIV');
  return divs.length ? divs : [root];
}

/**
 * Reads a page into units, in document order.
 * @param {Document} doc parsed .plain.html or DA source
 * @returns {Array<{kind: string, location: string, text: string, label?: string,
 *   src?: string, links?: string[], level?: number}>}
 */
export function readUnits(doc) {
  const units = [];
  const state = {};
  sectionsOf(doc).forEach((section) => {
    elements(section).forEach((el) => {
      if (el.tagName === 'DIV' && el.getAttribute('class')) {
        readBlock(el, units);
      } else {
        readElement(el, units, () => contentLocation(state), state);
      }
    });
  });
  return units;
}

/**
 * The published metadata, read from the live page's <head>, as "Page metadata" units for
 * the labels the draft uses (live .plain.html has no metadata block to compare with).
 * @param {string} headHtml the live page's <head> content
 * @param {string[]} labels metadata labels in the draft, e.g. ["Title", "Description"]
 */
export function headMetaUnits(headHtml, labels, Parser = DOMParser) {
  if (!headHtml || !labels.length) return [];
  const doc = new Parser().parseFromString(`<html><head>${headHtml}</head><body></body></html>`, 'text/html');
  const meta = (name) => [...doc.querySelectorAll('meta')]
    .find((m) => (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase() === name);
  return labels.map((label) => {
    const key = clean(label).toLowerCase().replace(/\s+/g, '-');
    if (key === 'title') {
      const title = doc.querySelector('title');
      return title ? { text: clean(title.textContent) } : null;
    }
    const tag = meta(key === 'image' ? 'og:image' : key);
    if (!tag) return null;
    return key === 'image'
      ? { text: '', src: imageKey(tag.getAttribute('content')) }
      : { text: clean(tag.getAttribute('content')) };
  }).map((found, i) => (found ? {
    kind: 'meta', location: META_BLOCKS.metadata, label: labels[i], ...found,
  } : null)).filter(Boolean);
}

const SITE_ORIGIN = /^https?:\/\/[^/]+\.aem\.(page|live)(?=\/|$)/i;

/**
 * Makes a DA draft and a published page comparable. Image files have different URLs on
 * each side (content.da.live vs media_<hash>), so pictures compare by alt text; links to
 * the site itself compare by path; section settings are not in .plain.html.
 */
export function crossComparable(units) {
  return units
    .filter((u) => !(u.kind === 'meta' && u.location === META_BLOCKS['section-metadata']))
    .map((u) => {
      const out = { ...u };
      if (out.links) out.links = out.links.map((href) => href.replace(SITE_ORIGIN, '') || '/');
      if (out.src) {
        delete out.src;
        if (out.kind === 'meta') out.text = '';
      }
      return out;
    });
}
