/**
 * Reads the live document EW sends to extensions. Blocks are the divs inside each
 * section, in the same order EW counts them for selection.blockIndex. EW adds
 * data-* attributes for its own bookkeeping; they are removed before comparing or
 * writing block HTML.
 */

const NOT_BLOCKS = new Set(['metadata', 'section-metadata', 'da-metadata', 'library-metadata']);

export const classesOf = (el) => String(el?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean);

export function parseHtml(html, Parser = DOMParser) {
  return new Parser().parseFromString(String(html ?? ''), 'text/html');
}

export function blockElements(doc) {
  const main = doc.querySelector('main') || doc.body;
  if (!main) return [];
  return [...main.children].flatMap((section) => [...section.children])
    .filter((el) => el.tagName === 'DIV' && classesOf(el).length
      && !NOT_BLOCKS.has(classesOf(el)[0]));
}

/** Removes EW's data-* instrumentation from an element and its children, in place. */
export function strip(el) {
  [el, ...el.querySelectorAll('*')].forEach((node) => {
    [...node.attributes].forEach(({ name }) => {
      if (name.startsWith('data-')) node.removeAttribute(name);
    });
  });
  return el;
}

/** A clean copy of a block element, without EW's instrumentation. */
export function cleanBlock(el) {
  return strip(el.cloneNode(true));
}

/** A whitespace-insensitive fingerprint of a block, used to spot changes. */
export function signature(elOrHtml, Parser) {
  let el = elOrHtml;
  if (typeof elOrHtml === 'string') {
    const doc = parseHtml(`<main><div>${elOrHtml}</div></main>`, Parser);
    [el] = blockElements(doc);
    if (!el) return '';
  }
  return cleanBlock(el).outerHTML
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

export function blockName(el) {
  return classesOf(el)[0] || '';
}

const words = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** A short summary of every block on the page, for the block list. */
export function outline(doc) {
  return blockElements(doc).map((el, index) => ({
    index,
    name: blockName(el),
    variants: classesOf(el).slice(1),
    text: words(el.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || el.textContent, 60),
  }));
}

/** Makes `./media_…` and site-relative image paths absolute for previews. */
export function previewUrl(src, pageUrl) {
  if (!src) return '';
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src;
  }
}
