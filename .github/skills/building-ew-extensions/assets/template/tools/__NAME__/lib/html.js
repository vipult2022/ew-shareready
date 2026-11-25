/**
 * HTML for the page. EW takes DA document HTML: block tables, not EDS div markup.
 * Everything from the service is escaped.
 */

import { escapeHtml } from './dom.js';
import { safeUrl } from './items.js';

/** A DA block table. The first row names the block; each row in rows is a list of cell HTML. */
export function blockTable(name, rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const head = `<tr><td colspan="${width}"><p>${escapeHtml(name)}</p></td></tr>`;
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
}

/** Plain content by default, so it works on any site; wrapped in a block only if configured. */
export function itemHtml(item, settings = {}) {
  const level = /^[2-6]$/.test(settings['heading-level'] || '') ? settings['heading-level'] : '3';
  const url = safeUrl(item.url);
  const parts = [
    `<h${level}>${escapeHtml(item.title)}</h${level}>`,
    item.summary ? `<p>${escapeHtml(item.summary)}</p>` : '',
    url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(settings['link-text'] || 'Read more')}</a></p>` : '',
  ].join('');
  return settings.block ? blockTable(settings.block, [[parts]]) : parts;
}

export function itemText(item) {
  return [item.title, item.summary, safeUrl(item.url)].filter(Boolean).join('\n\n');
}

/**
 * Why inserting is not possible right now, or '' when it is.
 * sendHTML inserts at the cursor: inside a block it would nest a table in a cell.
 */
export function insertBlocker({ mode, live = {} }) {
  if (mode === 'demo') return 'Sample mode: open this panel from Experience Workspace to insert. Copy works here too.';
  if (live.editable === false) return 'You cannot edit this page, so nothing was inserted.';
  if (mode === 'ew' && live.blockIndex !== null && live.blockIndex !== undefined) {
    return 'Your cursor is inside a block. Click an empty line outside it, then press Insert again.';
  }
  return '';
}
