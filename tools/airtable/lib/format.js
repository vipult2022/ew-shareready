/**
 * Turns Airtable records into Document Authoring content: a Table, Cards or Accordion block,
 * or plain headings and paragraphs. Blocks use DA's table form (first row is the block name),
 * which is what EW's sendHTML inserts and what DA saves as a block.
 *
 * Values arrive as Airtable's display strings (cellFormat=string); the field type from the
 * schema decides how each one becomes HTML.
 */

export const FORMATS = {
  table: {
    label: 'Table', block: 'Table', hint: 'Rates, prices, specs: one row per record.',
  },
  cards: {
    label: 'Cards', block: 'Cards', hint: 'Products and offers, with a photo when there is one.',
  },
  accordion: {
    label: 'Accordion', block: 'Accordion', hint: 'FAQs: the first field is the question.',
  },
  text: {
    label: 'Text', block: '', hint: 'Headings and paragraphs, no block.',
  },
};

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const SAFE_URL = /^(https?:|mailto:|tel:)/i;
const LONG = ['richText', 'multilineText', 'multipleAttachments'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function safeHref(url) {
  const clean = String(url || '').trim();
  return SAFE_URL.test(clean) ? escapeHtml(clean) : '';
}

/** "photo.jpg (https://…), plan.pdf (https://…)" → [{ name, url, image }] */
export function parseAttachments(value) {
  const out = [];
  const pattern = /\s*(.*?)\s*\((https:\/\/[^\s)]+)\)\s*(?:,|$)/g;
  let match = pattern.exec(String(value || ''));
  while (match) {
    const name = match[1] || 'attachment';
    out.push({ name, url: match[2], image: IMAGE_EXT.test(name) });
    match = pattern.exec(String(value || ''));
  }
  return out;
}

/** Airtable rich text Markdown: bold, italic, strike, code, links. */
function inlineMarkdown(text) {
  const codes = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (all, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  html = html
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
      const href = safeHref(url.replace(/&amp;/g, '&'));
      return href ? `<a href="${href}">${label}</a>` : label;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');
  // eslint-disable-next-line no-control-regex
  return html.replace(/\u0000(\d+)\u0000/g, (all, i) => codes[Number(i)]);
}

/** Airtable rich text (Markdown) to DA HTML: paragraphs, headings, lists, quotes, code. */
export function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  let code = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMarkdown).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  lines.forEach((line) => {
    if (code) {
      if (/^```/.test(line.trim())) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(line);
      return;
    }
    if (/^```/.test(line.trim())) {
      flushPara();
      flushList();
      code = [];
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(?:\[[ x]\]\s+)?(.*)$/);
    const number = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length + 2;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet || number) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || number)[1]);
    } else if (quote) {
      flushPara();
      flushList();
      out.push(`<blockquote><p>${inlineMarkdown(quote[1])}</p></blockquote>`);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  });
  if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushPara();
  flushList();
  return out.join('');
}

function multiline(text) {
  return String(text || '').trim().split(/\n\s*\n/)
    .map((p) => `<p>${p.split('\n').map((l) => escapeHtml(l.trim())).join('<br>')}</p>`)
    .join('');
}

function image(att, alt, imageSrc) {
  const src = escapeHtml(imageSrc(att));
  return `<p><picture><img src="${src}" alt="${escapeHtml(alt)}"></picture></p>`;
}

/** One value as inline HTML (no paragraphs). Long types fall back to plain text. */
export function inlineValue(value, field, opts = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  switch (field?.type) {
    case 'url': {
      const href = safeHref(text);
      const label = opts.linkText || text;
      return href ? `<a href="${href}">${escapeHtml(label)}</a>` : escapeHtml(text);
    }
    case 'email':
      return `<a href="mailto:${escapeHtml(text)}">${escapeHtml(text)}</a>`;
    case 'phoneNumber':
      return `<a href="tel:${escapeHtml(text.replace(/[^\d+]/g, ''))}">${escapeHtml(text)}</a>`;
    case 'checkbox':
      return text === 'checked' || text === 'true' ? 'Yes' : '';
    case 'richText':
      return inlineMarkdown(text.replace(/\s*\n+\s*/g, ' '));
    case 'multipleAttachments':
      return parseAttachments(text).map((a) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`).join(', ');
    default:
      return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/** One value as block HTML (paragraphs, lists, pictures). */
export function blockValue(value, field, opts = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (field?.type === 'richText') return markdownToHtml(text);
  if (field?.type === 'multilineText') return multiline(text);
  if (field?.type === 'multipleAttachments') {
    return parseAttachments(text).map((a) => (a.image
      ? image(a, opts.alt || '', opts.imageSrc || ((x) => x.url))
      : `<p><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a></p>`)).join('');
  }
  const inline = inlineValue(text, field, opts);
  return inline ? `<p>${inline}</p>` : '';
}

/** A field for cards, accordions and text: short values get their field name in front. */
function labelled(value, field, opts) {
  if (!opts.labels || LONG.includes(field.type)) return blockValue(value, field, opts);
  const inline = inlineValue(value, field, opts);
  return inline ? `<p><strong>${escapeHtml(field.name)}:</strong> ${inline}</p>` : '';
}

function blockTable(name, rows, width) {
  const head = `<tr><td colspan="${width}"><p>${escapeHtml(name)}</p></td></tr>`;
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
}

/** The first image attachment of a record, for card photos. */
function firstImage(record, fields) {
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].type === 'multipleAttachments') {
      const att = parseAttachments(record.fields[fields[i].name]).find((a) => a.image);
      if (att) return { att, field: fields[i] };
    }
  }
  return null;
}

/** Suggests a format from the table's field types. */
export function suggestFormat(table) {
  const types = (table?.fields || []).map((f) => f.type);
  if (types.includes('multipleAttachments')) return 'cards';
  const first = table?.fields?.find((f) => f.id === table.primaryFieldId) || table?.fields?.[0];
  if (types.includes('richText') && /\?|question|faq/i.test(`${first?.name} ${table?.name}`)) return 'accordion';
  if (/faq|question/i.test(table?.name || '')) return 'accordion';
  return 'table';
}

/**
 * Builds the content. `fields` are schema fields in display order; the first is the title
 * (card heading, accordion question). Options: block (name override), header (table header
 * row), labels (field names in cards, accordions and text), linkText, imageSrc(att).
 */
export function buildContent(format, fields, records, options = {}) {
  const opts = {
    header: true, labels: true, linkText: 'Learn more', imageSrc: (a) => a.url, ...options,
  };
  const def = FORMATS[format] || FORMATS.table;
  const noHeader = format === 'table' && !opts.header && !opts.block;
  const blockName = noHeader ? 'Table (no header)' : String(opts.block || def.block).trim();
  if (!fields.length || !records.length) return '';
  const [titleField, ...rest] = fields;
  const title = (r) => String(r.fields[titleField.name] ?? '').trim();

  if (format === 'cards') {
    const rows = records.map((r) => {
      const photo = firstImage(r, fields);
      const parts = [];
      if (titleField.type !== 'multipleAttachments' && title(r)) parts.push(`<h3>${inlineValue(title(r), titleField)}</h3>`);
      rest.forEach((f) => {
        if (photo && f === photo.field) return;
        if (f.type === 'url') {
          const link = inlineValue(r.fields[f.name], f, { linkText: opts.linkText });
          if (link) parts.push(`<p>${link}</p>`);
          return;
        }
        parts.push(labelled(r.fields[f.name], f, { ...opts, alt: title(r) }));
      });
      const body = parts.filter(Boolean).join('');
      return photo ? [image(photo.att, title(r), opts.imageSrc), body] : [body];
    });
    const width = Math.max(...rows.map((r) => r.length));
    const even = rows.map((r) => (r.length < width ? ['', ...r] : r));
    return blockTable(blockName, even, width);
  }

  if (format === 'accordion') {
    const rows = records.map((r) => [
      `<p>${inlineValue(title(r), titleField)}</p>`,
      rest.map((f) => labelled(r.fields[f.name], f, { ...opts, alt: title(r) })).join(''),
    ]);
    return blockTable(blockName, rows, 2);
  }

  if (format === 'text') {
    return records.map((r) => {
      const heading = title(r) ? `<h3>${inlineValue(title(r), titleField)}</h3>` : '';
      return heading + rest.map((f) => labelled(r.fields[f.name], f, { ...opts, alt: title(r) })).join('');
    }).join('');
  }

  const head = opts.header ? [fields.map((f) => `<p>${escapeHtml(f.name)}</p>`)] : [];
  const rows = records.map((r) => fields.map((f) => {
    if (LONG.includes(f.type)) return blockValue(r.fields[f.name], f, { ...opts, alt: title(r) });
    const inline = inlineValue(r.fields[f.name], f, { linkText: '' });
    return inline ? `<p>${inline}</p>` : '';
  }));
  return blockTable(blockName, [...head, ...rows], fields.length);
}

/** Every image the content will show, so they can be copied into DA before inserting. */
export function imagesIn(format, fields, records, options = {}) {
  const seen = new Map();
  buildContent(format, fields, records, {
    ...options,
    imageSrc: (att) => {
      seen.set(att.url, att);
      return att.url;
    },
  });
  return [...seen.values()];
}
