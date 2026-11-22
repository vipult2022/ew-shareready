/**
 * Cleans rich text (typed, pasted from Word or Google Docs, or read from the page)
 * down to the small set of tags a block cell can hold. Everything else is unwrapped
 * or dropped, and link URLs are limited to safe schemes.
 */

import { escapeHtml } from './dom.js';

const INLINE = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  U: 'u',
  INS: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  SUB: 'sub',
  SUP: 'sup',
  CODE: 'code',
};

const DROP = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'CANVAS', 'NOSCRIPT', 'BUTTON', 'INPUT',
  'SELECT', 'TEXTAREA', 'FORM', 'O:P', 'MATH',
]);

const BLOCK = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER',
  'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'PRE', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'UL', 'OL', 'LI', 'HR', 'BODY',
  'HTML',
]);

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/** Returns the URL when it is safe to keep in a link, otherwise ''. */
export function safeUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^(\/|#|\.\.?\/|\?)/.test(url)) return url;
  // eslint-disable-next-line no-control-regex
  const compact = url.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  const scheme = compact.match(/^([a-z][a-z0-9+.-]*:)/)?.[1];
  if (!scheme) return url;
  return SAFE_SCHEMES.includes(scheme) ? url : '';
}

const tagOf = (node) => (node.tagName || '').toUpperCase();
const styleOf = (node) => (node.getAttribute?.('style') || '').toLowerCase().replace(/\s+/g, '');
const isText = (node) => node.nodeType === 3;
const isElement = (node) => node.nodeType === 1;

function textHtml(text) {
  return escapeHtml(text.replace(/[ \t\n\r\f]+/g, ' ')).replaceAll('\u00a0', '&nbsp;');
}

function wordListMarker(node) {
  return /mso-list:ignore/.test(styleOf(node));
}

function inlineTag(node) {
  const tag = tagOf(node);
  const style = styleOf(node);
  if (tag === 'B' && /font-weight:(normal|[1-4]00)/.test(style)) return '';
  if (INLINE[tag]) return INLINE[tag];
  if (tag === 'SPAN' || tag === 'FONT') {
    if (/font-weight:(bold|[6-9]00)/.test(style)) return 'strong';
    if (/font-style:italic/.test(style)) return 'em';
    if (/text-decoration[^;]*underline/.test(style)) return 'u';
  }
  return '';
}

function inline(node) {
  if (isText(node)) return textHtml(node.textContent);
  if (!isElement(node)) return '';
  const tag = tagOf(node);
  if (DROP.has(tag) || wordListMarker(node)) return '';
  if (tag === 'BR') return '<br>';
  const inner = [...node.childNodes].map(inline).join('');
  if (tag === 'A') {
    const href = safeUrl(node.getAttribute('href'));
    if (!href || !inner.trim()) return inner;
    const title = node.getAttribute('title');
    return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</a>`;
  }
  if (BLOCK.has(tag)) return inner ? `${inner} ` : '';
  const mapped = inlineTag(node);
  if (!mapped || !inner.replace(/&nbsp;|\s/g, '')) return inner;
  return `<${mapped}>${inner}</${mapped}>`;
}

function tidy(html) {
  return html
    .replace(/^(\s|&nbsp;|<br>)+/, '')
    .replace(/(\s|&nbsp;|<br>)+$/, '')
    .replace(/ {2,}/g, ' ');
}

function isEmptyHtml(html) {
  return !html.replace(/<br>|&nbsp;|\s/g, '');
}

function hasBlockChild(node) {
  return [...node.childNodes].some((child) => isElement(child) && BLOCK.has(tagOf(child)));
}

function list(node) {
  const tag = tagOf(node) === 'OL' ? 'ol' : 'ul';
  const items = [];
  let loose = '';
  const pushLoose = () => {
    const text = tidy(loose);
    if (!isEmptyHtml(text)) items.push(`<li>${text}</li>`);
    loose = '';
  };
  [...node.childNodes].forEach((child) => {
    if (isElement(child) && tagOf(child) === 'LI') {
      pushLoose();
      const nested = [];
      const text = [...child.childNodes].map((part) => {
        if (isElement(part) && ['UL', 'OL'].includes(tagOf(part))) {
          nested.push(list(part));
          return '';
        }
        if (isElement(part) && tagOf(part) === 'P') return `${[...part.childNodes].map(inline).join('')}<br>`;
        return inline(part);
      }).join('');
      const body = tidy(text);
      if (!isEmptyHtml(body) || nested.length) items.push(`<li>${body}${nested.join('')}</li>`);
    } else if (isElement(child) && ['UL', 'OL'].includes(tagOf(child))) {
      pushLoose();
      items.push(`<li>${list(child)}</li>`);
    } else loose += inline(child);
  });
  pushLoose();
  return items.length ? `<${tag}>${items.join('')}</${tag}>` : '';
}

const HEADING = /^H[1-6]$/;

function flow(node, out, blocks) {
  let buffer = '';
  const flush = () => {
    const text = tidy(buffer);
    if (!isEmptyHtml(text)) out.push(`<p>${text}</p>`);
    buffer = '';
  };
  [...node.childNodes].forEach((child) => {
    if (!isElement(child)) {
      buffer += inline(child);
      return;
    }
    const tag = tagOf(child);
    if (DROP.has(tag) || wordListMarker(child)) return;
    if (tag === 'UL' || tag === 'OL') {
      flush();
      const html = list(child);
      if (html) out.push(html);
    } else if (tag === 'LI') {
      flush();
      const html = list({ childNodes: [child], tagName: 'UL' });
      if (html) out.push(html);
    } else if (tag === 'HR') flush();
    else if (blocks && HEADING.test(tag) && !hasBlockChild(child)) {
      flush();
      const text = tidy([...child.childNodes].map(inline).join(''));
      const name = tag.toLowerCase();
      if (!isEmptyHtml(text)) out.push(`<${name}>${text}</${name}>`);
    } else if (blocks && tag === 'BLOCKQUOTE') {
      flush();
      const inner = flow(child, [], false);
      if (inner.length) out.push(`<blockquote>${inner.join('')}</blockquote>`);
    } else if (!BLOCK.has(tag) && hasBlockChild(child)) {
      // Google Docs wraps a whole paste in <b style="font-weight:normal">.
      flush();
      flow(child, out, blocks);
    } else if (BLOCK.has(tag)) {
      flush();
      if (hasBlockChild(child)) flow(child, out, blocks);
      else {
        buffer = [...child.childNodes].map(inline).join('');
        flush();
      }
    } else buffer += inline(child);
  });
  flush();
  return out;
}

function container(html, doc) {
  const div = doc.createElement('div');
  div.innerHTML = String(html ?? '');
  return div;
}

/**
 * Cleans HTML for a rich text field: paragraphs, lists, headings, quotes and inline
 * formatting. With `blocks: false` headings and quotes become paragraphs.
 * @param {string} html
 * @param {Document} doc any document, used to parse the HTML
 * @param {{blocks?: boolean}} [options]
 */
export function cleanFlow(html, doc, { blocks = true } = {}) {
  return flow(container(html, doc), [], blocks).join('');
}

/** Cleans HTML for a single-line field such as a heading: inline formatting only. */
export function cleanInline(html, doc) {
  return tidy([...container(html, doc).childNodes].map(inline).join('').replace(/<br>$/, ''));
}

/** Turns pasted plain text into paragraphs, keeping single line breaks. */
export function textToHtml(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${part.split('\n').map((line) => escapeHtml(line)).join('<br>')}</p>`)
    .join('');
}

/** Visible text of a piece of HTML, whitespace collapsed. */
export function textOf(html, doc) {
  return container(html, doc).textContent.replace(/\s+/g, ' ').trim();
}
