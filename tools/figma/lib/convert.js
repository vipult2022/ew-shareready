/**
 * Turns the analysed design (lib/design.js) into Document Authoring content: default content
 * plus Hero, Cards, Columns, Accordion, Table and Metadata blocks in DA's table form (first
 * row is the block name). EW's sendHTML inserts that form and DA stores it, so the same HTML
 * works for Insert and for a new page. Each design section becomes a page section.
 *
 * Buttons become links on their own line: the first of a group bold (primary), the others
 * italic (secondary), which is how Edge Delivery Services decorates buttons.
 */

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function safeHref(url) {
  const value = String(url || '').trim();
  return SAFE_URL.test(value) && !/^\/\//.test(value) ? escapeHtml(value) : '';
}

export function blockTable(name, rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const head = `<tr><td colspan="${width}"><p>${escapeHtml(name)}</p></td></tr>`;
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
}

const lines = (text) => escapeHtml(text).replace(/\n/g, '<br>');

/** One item as HTML. `opts.imageSrc(id)` gives each picture's URL; `primary` bolds a button. */
export function itemHtml(item, opts = {}, primary = true) {
  const imageSrc = opts.imageSrc || ((id) => id);
  switch (item.kind) {
    case 'heading':
      return `<h${item.level}>${lines(item.text)}</h${item.level}>`;
    case 'text': {
      const href = safeHref(item.link);
      return href ? `<p><a href="${href}">${lines(item.text)}</a></p>` : `<p>${lines(item.text)}</p>`;
    }
    case 'button': {
      const link = `<a href="${safeHref(item.link) || '#'}">${escapeHtml(item.text)}</a>`;
      return primary ? `<p><strong>${link}</strong></p>` : `<p><em>${link}</em></p>`;
    }
    case 'image': {
      const src = escapeHtml(imageSrc(item.image) || '');
      const alt = escapeHtml((opts.alt && opts.alt(item)) || item.alt || '');
      return src ? `<p><picture><img src="${src}" alt="${alt}"></picture></p>` : '';
    }
    default:
      return '';
  }
}

/** A list of items, with the first button of each run as the primary one. */
export function itemsHtml(items, opts) {
  let run = 0;
  return (items || []).map((item) => {
    run = item.kind === 'button' ? run + 1 : 0;
    return itemHtml(item, opts, run <= 1);
  }).join('');
}

export function sectionHtml(section, opts = {}) {
  if (section.block === 'Text' || !section.rows) return itemsHtml(section.items, opts);
  const rows = section.rows.map((row) => row.map((cell) => itemsHtml(cell, opts)));
  const name = section.block === 'Table' ? 'Table (no header)' : section.block;
  return itemsHtml(section.lead, opts) + blockTable(name, rows);
}

export function metadataBlock(model) {
  const rows = [['Title', model.title], ['Description', model.description]]
    .filter(([, value]) => value)
    .map(([key, value]) => [`<p>${key}</p>`, `<p>${escapeHtml(value)}</p>`]);
  return rows.length ? blockTable('Metadata', rows) : '';
}

/** { sections: [html], html } — `html` joins sections with <hr>, which DA turns into breaks. */
export function convert(model, options = {}) {
  const opts = { metadata: true, ...options };
  const sections = (model.sections || []).map((s) => sectionHtml(s, opts)).filter((s) => s.trim());
  if (opts.metadata && sections.length) sections[sections.length - 1] += metadataBlock(model);
  return { sections, html: sections.join('<hr>') };
}

/** A whole DA document, as the source API stores it. */
export function documentHtml(sections) {
  const main = (sections.length ? sections : ['']).map((s) => `<div>${s}</div>`).join('');
  return `<body><header></header><main>${main}</main><footer></footer></body>`;
}

/** "/offers/Spring Savings 2027" → "/offers/spring-savings-2027" ('' when nothing is left). */
export function cleanPath(value) {
  const parts = String(value || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/\.html$/i, '')
    .split('/')
    .map((p) => p.toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|-+$/g, ''))
    .filter(Boolean);
  return parts.length ? `/${parts.join('/')}` : '';
}

/** Where a new page goes: the path the designer typed, or folder + frame name. */
export function suggestPath(handoff, folder = '/drafts') {
  const fromDesigner = cleanPath(handoff?.path);
  if (fromDesigner) return fromDesigner;
  const slug = cleanPath(handoff?.name).slice(1).replace(/\//g, '-') || 'figma-page';
  return `${cleanPath(folder)}/${slug}`;
}
