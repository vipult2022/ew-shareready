/**
 * Turns a Notion page (properties and block tree from lib/notion.js) into Document Authoring
 * content: headings, paragraphs and lists, plus Table, Accordion, Columns and Metadata blocks
 * in DA's table form (first row is the block name). That form is what EW's sendHTML inserts
 * and what DA stores, so the same HTML works for Insert and for a new page.
 *
 *   toggles and toggle headings  → Accordion (one item each, consecutive ones together)
 *   tables                       → Table, or "Table (no header)"
 *   columns                      → Columns
 *   dividers                     → section breaks
 *   callouts and quotes          → quotes
 *   images                       → pictures (copied into the site first, see lib/images.js)
 *   sub-pages and databases      → left out, and listed in `skipped`
 */

const SAFE_URL = /^(https?:|mailto:|tel:)/i;
const LISTS = { bulleted_list_item: 'ul', numbered_list_item: 'ol', to_do: 'ul' };
const HEADINGS = { heading_1: 1, heading_2: 2, heading_3: 3 };

export const DEFAULT_OPTIONS = {
  title: true,
  metadata: true,
  sections: true,
  description: 'Description',
  keywords: 'Keywords',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function safeHref(url) {
  const clean = String(url || '').trim();
  return SAFE_URL.test(clean) ? escapeHtml(clean) : '';
}

export const plain = (rich) => (rich || []).map((r) => r.text).join('');

/** Rich text to inline HTML. Every Notion value is escaped. */
export function inline(rich) {
  return (rich || []).map((r) => {
    let html = escapeHtml(r.text).replace(/\n/g, '<br>');
    if (!html) return '';
    if (r.code) html = `<code>${html}</code>`;
    if (r.bold) html = `<strong>${html}</strong>`;
    if (r.italic) html = `<em>${html}</em>`;
    if (r.strike) html = `<s>${html}</s>`;
    if (r.underline) html = `<u>${html}</u>`;
    const href = safeHref(r.href);
    return href ? `<a href="${href}">${html}</a>` : html;
  }).join('');
}

export function blockTable(name, rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const head = `<tr><td colspan="${width}"><p>${escapeHtml(name)}</p></td></tr>`;
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
}

const isToggle = (b) => b.type === 'toggle' || (HEADINGS[b.type] && b.toggle);

/** The name an image gets in the site's media folder: its caption, or its file name. */
export function imageName(url, caption = '') {
  if (caption.trim()) return caption.trim().slice(0, 60);
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return /\.(avif|gif|jpe?g|png|webp)$/i.test(last) && !/^media_/.test(last) ? last : 'notion-image';
  } catch {
    return 'notion-image';
  }
}

/** Every picture in the tree: [{ url, name, expires }], each URL once. */
export function imagesIn(blocks) {
  const seen = new Map();
  const walk = (list) => (list || []).forEach((b) => {
    if (b.type === 'image' && SAFE_URL.test(b.url || '') && !seen.has(b.url)) {
      const name = imageName(b.url, plain(b.caption));
      seen.set(b.url, { url: b.url, name, expires: !!b.expires });
    }
    walk(b.children);
  });
  walk(blocks);
  return [...seen.values()];
}

function renderer(opts, skipped) {
  const shift = opts.title ? 1 : 0;
  const imageSrc = opts.imageSrc || ((url) => url);

  let render;

  const heading = (b) => {
    const level = Math.min(HEADINGS[b.type] + shift, 6);
    const html = inline(b.rich);
    return html ? `<h${level}>${html}</h${level}>` : '';
  };

  const listItem = (b, ctx) => {
    const box = b.type === 'to_do' ? `${b.checked ? '☑' : '☐'} ` : '';
    return `<li>${box}${inline(b.rich)}${render(b.children, ctx)}</li>`;
  };

  const picture = (b) => {
    const src = SAFE_URL.test(b.url || '') ? escapeHtml(imageSrc(b.url)) : '';
    if (!src) return '';
    return `<p><picture><img src="${src}" alt="${escapeHtml(plain(b.caption))}"></picture></p>`;
  };

  const link = (b) => {
    const href = safeHref(b.url);
    if (!href) return '';
    const label = inline(b.caption) || escapeHtml(b.name || b.url);
    return `<p><a href="${href}">${label}</a></p>`;
  };

  const tableRows = (b) => (b.children || []).filter((r) => r.type === 'table_row')
    .map((r) => r.cells.map((cell) => {
      const html = inline(cell);
      return html ? `<p>${html}</p>` : '';
    }));

  const one = (b, ctx) => {
    switch (b.type) {
      case 'paragraph': {
        const html = inline(b.rich);
        return (html ? `<p>${html}</p>` : '') + render(b.children, ctx);
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return heading(b) + render(b.children, ctx);
      case 'quote':
        return `<blockquote><p>${inline(b.rich)}</p>${render(b.children, ctx)}</blockquote>`;
      case 'callout': {
        const text = [b.icon && escapeHtml(b.icon), inline(b.rich)].filter(Boolean).join(' ');
        return `<blockquote><p>${text}</p>${render(b.children, ctx)}</blockquote>`;
      }
      case 'toggle':
        return `<p><strong>${inline(b.rich)}</strong></p>${render(b.children, ctx)}`;
      case 'code':
        return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
      case 'image':
        return picture(b);
      case 'link':
        return link(b);
      case 'table': {
        const rows = tableRows(b);
        if (!rows.length) return '';
        if (ctx.cell) return rows.map((r) => `<p>${r.map((c) => c.replace(/^<p>|<\/p>$/g, '')).filter(Boolean).join(' · ')}</p>`).join('');
        return blockTable(b.header ? 'Table' : 'Table (no header)', rows);
      }
      case 'column_list': {
        const cols = (b.children || []).filter((c) => c.type === 'column');
        if (ctx.cell || cols.length < 2) return cols.map((c) => render(c.children, ctx)).join('');
        return blockTable('Columns', [cols.map((c) => render(c.children, { cell: true }))]);
      }
      case 'column':
      case 'synced_block':
        return render(b.children, ctx);
      case 'child_page':
        skipped.push(`Sub-page “${b.title || 'Untitled'}”`);
        return '';
      case 'child_database':
        skipped.push(`Database “${b.title || 'Untitled'}”`);
        return '';
      default:
        return '';
    }
  };

  /** Renders a list of sibling blocks, grouping list items and toggles. */
  render = (blocks, ctx = { cell: false }) => {
    const list = blocks || [];
    const out = [];
    const inner = { cell: !!ctx.cell };
    let i = 0;
    while (i < list.length) {
      const b = list[i];
      if (LISTS[b.type]) {
        const tag = LISTS[b.type];
        const items = [];
        while (i < list.length && LISTS[list[i].type] === tag && (list[i].type === 'to_do') === (b.type === 'to_do')) {
          items.push(listItem(list[i], inner));
          i += 1;
        }
        out.push(`<${tag}>${items.join('')}</${tag}>`);
      } else if (isToggle(b) && !ctx.cell) {
        const rows = [];
        while (i < list.length && isToggle(list[i])) {
          const label = inline(list[i].rich);
          rows.push([`<p>${label}</p>`, render(list[i].children, { cell: true })]);
          i += 1;
        }
        out.push(blockTable('Accordion', rows));
      } else if (b.type === 'divider') {
        out.push(ctx.top && opts.sections ? '\u0000section\u0000' : '');
        i += 1;
      } else {
        out.push(one(b, inner));
        i += 1;
      }
    }
    return out.join('');
  };

  return render;
}

function property(page, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return '';
  return (page.properties || []).find((p) => p.name.trim().toLowerCase() === want)?.value?.trim() || '';
}

export function metadataBlock(page, opts) {
  const rows = [
    ['Title', page.title],
    ['Description', property(page, opts.description)],
    ['Keywords', property(page, opts.keywords)],
  ].filter(([, value]) => value).map(([key, value]) => [`<p>${key}</p>`, `<p>${escapeHtml(value)}</p>`]);
  return rows.length ? blockTable('Metadata', rows) : '';
}

/**
 * { sections: [html], html, images, skipped }. `html` joins sections with <hr>, which DA
 * turns into section breaks on insert.
 */
export function convertPage({ page = {}, blocks = [], truncated = false } = {}, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const skipped = [];
  const render = renderer(opts, skipped);
  const body = render(blocks, { cell: false, top: true });
  const sections = body.split('\u0000section\u0000');
  if (opts.title && page.title) sections[0] = `<h1>${escapeHtml(page.title)}</h1>${sections[0]}`;
  if (opts.metadata) sections[sections.length - 1] += metadataBlock(page, opts);
  const kept = sections.filter((s) => s.trim());
  if (truncated) skipped.push('The end of a very long page');
  return {
    sections: kept,
    html: kept.join('<hr>'),
    images: imagesIn(blocks),
    skipped,
  };
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

/** Where a new page from this Notion page goes: its "Page path" property, or folder + title. */
export function suggestPath(page, { pathProperty = 'Page path', folder = '/drafts' } = {}) {
  const fromProp = cleanPath(property(page, pathProperty));
  if (fromProp) return fromProp;
  const slug = cleanPath(page.title).slice(1) || 'untitled';
  return `${cleanPath(folder) || ''}/${slug.replace(/\//g, '-')}`;
}
