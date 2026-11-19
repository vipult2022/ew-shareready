/**
 * Notion API helpers, used by the worker (and the tests). They call the API, turn Notion
 * errors into messages an author can act on, and reduce pages, databases and blocks to small
 * shapes, so the panel never handles raw Notion JSON.
 *
 * Notion's API does not allow calls from a browser (no CORS), so these only run in the worker.
 */

export const API = 'https://api.notion.com/v1';
export const VERSION = '2022-06-28';
export const MAX_BLOCKS = 1000;
export const MAX_DEPTH = 6;
export const MAX_ENTRIES = 200;

const UUID = /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;
const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

export class NotionError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MESSAGES = {
  unauthorized: 'Notion did not accept the integration secret. Check the NOTION_TOKEN secret of the worker.',
  restricted_resource: 'The integration cannot read this page. In Notion, open it, choose ••• → Connections and add the integration.',
  object_not_found: 'Notion could not find that page. In Notion, open it, choose ••• → Connections and add the integration.',
  rate_limited: 'Notion is busy right now. Wait a few seconds and try again.',
  service_unavailable: 'Notion is not available right now. Try again in a minute.',
};

/** A Notion id from an id or a Notion link, in dashed form; '' when there is none. */
export function cleanId(value) {
  const text = String(value || '').trim();
  const raw = text.match(UUID)
    ? text
    : (text.match(/([0-9a-f]{32})(?:[/?#]|$)/i)?.[1] || text.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] || '');
  const m = raw.match(UUID);
  return m ? m.slice(1).join('-').toLowerCase() : '';
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** call(path, { method, body }) with the integration secret. Retries twice when Notion is busy. */
export function tokenCall(token, fetchImpl = fetch) {
  const call = async (path, { method = 'GET', body } = {}, attempt = 0) => {
    let resp;
    try {
      resp = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': VERSION,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new NotionError(502, 'Could not reach Notion. Try again.');
    }
    const retry = resp.status === 429 || (resp.status >= 502 && resp.status <= 504);
    if (retry && attempt < 2) {
      const after = Math.min(Number(resp.headers.get('Retry-After')) || 1, 5);
      await wait(after * 1000);
      return call(path, { method, body }, attempt + 1);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const code = data.code || '';
      // A bad integration secret is the worker's problem, not the author's sign-in.
      const status = resp.status === 401 ? 502 : resp.status;
      throw new NotionError(status, MESSAGES[code] || data.message || `Notion answered ${resp.status}.`, code);
    }
    return data;
  };
  return call;
}

/** Rich text to [{ text, bold?, italic?, strike?, underline?, code?, href? }]. */
export function richText(list) {
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    const a = r.annotations || {};
    const out = { text: String(r.plain_text ?? r.text?.content ?? '') };
    if (a.bold) out.bold = true;
    if (a.italic) out.italic = true;
    if (a.strikethrough) out.strike = true;
    if (a.underline) out.underline = true;
    if (a.code || r.type === 'equation') out.code = true;
    // Mentions link to Notion pages, which readers of the site cannot open.
    const href = r.type === 'mention' ? '' : String(r.href || r.text?.link?.url || '');
    if (href && SAFE_HREF.test(href)) out.href = href;
    return out;
  }).filter((r) => r.text);
}

export const plain = (rich) => (rich || []).map((r) => r.text).join('');

function fileUrl(file) {
  if (!file) return '';
  return file.type === 'external' ? file.external?.url || '' : file.file?.url || '';
}

/** One property as display text. */
export function propertyValue(prop) {
  if (!prop) return '';
  const value = prop[prop.type];
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return plain(richText(value));
    case 'number':
      return value === null || value === undefined ? '' : String(value);
    case 'select':
    case 'status':
      return value?.name || '';
    case 'multi_select':
      return (value || []).map((o) => o.name).join(', ');
    case 'date':
      return value ? [value.start, value.end].filter(Boolean).join(' → ') : '';
    case 'people':
      return (value || []).map((u) => u.name).filter(Boolean).join(', ');
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'url':
    case 'email':
    case 'phone_number':
    case 'created_time':
    case 'last_edited_time':
      return value || '';
    case 'created_by':
    case 'last_edited_by':
      return value?.name || '';
    case 'files':
      return (value || []).map((f) => f.name).filter(Boolean).join(', ');
    case 'formula': {
      const result = value?.[value?.type];
      if (value?.type === 'date') return result?.start || '';
      return result === null || result === undefined ? '' : String(result);
    }
    case 'unique_id':
      return value?.number ? `${value.prefix ? `${value.prefix}-` : ''}${value.number}` : '';
    case 'relation':
      return value?.length ? `${value.length} linked` : '';
    default:
      return '';
  }
}

function icon(item) {
  return item?.icon?.type === 'emoji' ? item.icon.emoji : '';
}

/** A page with its title, icon and properties (except the title). */
export function simplifyPage(page) {
  const props = Object.entries(page.properties || {});
  const titleProp = props.find(([, p]) => p.type === 'title');
  return {
    id: page.id,
    url: page.url || '',
    title: titleProp ? propertyValue(titleProp[1]).trim() : '',
    icon: icon(page),
    lastEdited: page.last_edited_time || '',
    database: page.parent?.type === 'database_id' ? page.parent.database_id : '',
    properties: props.filter(([, p]) => p.type !== 'title').map(([name, p]) => ({
      name,
      type: p.type,
      value: propertyValue(p),
      ...(p.select?.color || p.status?.color ? { color: p.select?.color || p.status?.color } : {}),
    })),
  };
}

export function simplifyDatabase(db) {
  return {
    id: db.id,
    url: db.url || '',
    title: plain(richText(db.title)).trim() || 'Untitled database',
    description: plain(richText(db.description)),
    icon: icon(db),
    properties: Object.entries(db.properties || {}).map(([name, p]) => ({ name, type: p.type })),
  };
}

/** Pages shared with the integration, newest first. Empty query lists recent pages. */
export async function searchPages(call, query = '', max = 50) {
  const data = await call('/search', {
    method: 'POST',
    body: {
      query: String(query).slice(0, 200),
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: Math.min(max, 100),
    },
  });
  return {
    pages: (data.results || []).filter((p) => !p.archived && !p.in_trash).map(simplifyPage),
    more: !!data.has_more,
  };
}

export async function listDatabases(call) {
  const data = await call('/search', {
    method: 'POST',
    body: { filter: { property: 'object', value: 'database' }, page_size: 100 },
  });
  return (data.results || []).filter((d) => !d.archived && !d.in_trash).map(simplifyDatabase);
}

/** A database and its entries, last edited first. */
export async function queryDatabase(call, id, max = MAX_ENTRIES) {
  const database = simplifyDatabase(await call(`/databases/${id}`));
  const pages = [];
  let cursor;
  let more = false;
  do {
    // eslint-disable-next-line no-await-in-loop
    const data = await call(`/databases/${id}/query`, {
      method: 'POST',
      body: {
        page_size: 100,
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      },
    });
    pages.push(...(data.results || []).map(simplifyPage));
    cursor = data.has_more ? data.next_cursor : null;
    more = !!cursor && pages.length >= max;
  } while (cursor && pages.length < max);
  return { database, pages: pages.slice(0, max), more };
}

/** One block in a small shape, or null for blocks a web page has no use for. */
export function normalizeBlock(raw) {
  const { type } = raw || {};
  const data = raw?.[type] || {};
  const rich = () => richText(data.rich_text);
  switch (type) {
    case 'paragraph':
    case 'quote':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'toggle':
      return { type, rich: rich() };
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return { type, rich: rich(), ...(data.is_toggleable ? { toggle: true } : {}) };
    case 'to_do':
      return { type, rich: rich(), checked: !!data.checked };
    case 'callout':
      return { type, rich: rich(), icon: data.icon?.type === 'emoji' ? data.icon.emoji : '' };
    case 'code':
      return { type, text: plain(rich()), language: data.language || '' };
    case 'equation':
      return { type: 'code', text: data.expression || '', language: 'latex' };
    case 'divider':
      return { type };
    case 'image':
      return {
        type, url: fileUrl(data), expires: data.type === 'file', caption: richText(data.caption),
      };
    case 'video':
    case 'file':
    case 'pdf':
    case 'audio':
      return {
        type: 'link', kind: type, url: fileUrl(data), caption: richText(data.caption), name: data.name || '',
      };
    case 'embed':
    case 'bookmark':
    case 'link_preview':
      return {
        type: 'link', kind: type, url: data.url || '', caption: richText(data.caption),
      };
    case 'table':
      return { type, header: !!data.has_column_header, rowHeader: !!data.has_row_header };
    case 'table_row':
      return { type, cells: (data.cells || []).map(richText) };
    case 'column_list':
    case 'column':
      return { type };
    case 'synced_block':
      return { type, from: data.synced_from?.block_id || '' };
    case 'child_page':
    case 'child_database':
      return { type, title: data.title || '' };
    default:
      return null;
  }
}

/**
 * A page's blocks as a tree: [{ type, …, children? }]. Stops after maxBlocks blocks or
 * maxDepth levels and says so with truncated: true. Synced blocks show their original.
 */
export async function blockTree(call, rootId, opts = {}) {
  const { maxBlocks = MAX_BLOCKS, maxDepth = MAX_DEPTH } = opts;
  let count = 0;
  let truncated = false;
  const children = async (id, depth) => {
    const out = [];
    let cursor;
    do {
      const query = `?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
      // eslint-disable-next-line no-await-in-loop
      const data = await call(`/blocks/${id}/children${query}`);
      const results = data.results || [];
      for (let i = 0; i < results.length; i += 1) {
        if (count >= maxBlocks) {
          truncated = true;
          break;
        }
        const raw = results[i];
        const block = normalizeBlock(raw);
        count += 1;
        if (block) {
          const deep = raw.has_children && !['child_page', 'child_database'].includes(raw.type);
          if (deep && depth < maxDepth) {
            const source = raw.type === 'synced_block' && block.from ? block.from : raw.id;
            try {
              // eslint-disable-next-line no-await-in-loop
              block.children = await children(source, depth + 1);
            } catch (error) {
              if (raw.type !== 'synced_block') throw error;
              block.children = [];
            }
          } else if (deep) truncated = true;
          out.push(block);
        }
      }
      cursor = data.has_more && count < maxBlocks ? data.next_cursor : null;
      if (data.has_more && count >= maxBlocks) truncated = true;
    } while (cursor);
    return out;
  };
  const blocks = await children(rootId, 1);
  return { blocks, truncated, count };
}

/** A page with its properties and block tree. */
export async function getPage(call, id, limits) {
  const page = simplifyPage(await call(`/pages/${id}`));
  const tree = await blockTree(call, id, limits);
  return { page, blocks: tree.blocks, truncated: tree.truncated };
}

/** Writes a link into a URL property, e.g. "EW page", so the brief points at the new page. */
export async function setUrlProperty(call, pageId, property, url) {
  const page = await call(`/pages/${pageId}`);
  const prop = page.properties?.[property];
  if (!prop) throw new NotionError(400, `This page has no “${property}” property. Add a URL property with that name in Notion.`);
  if (prop.type !== 'url') throw new NotionError(400, `The “${property}” property must be a URL property.`);
  await call(`/pages/${pageId}`, { method: 'PATCH', body: { properties: { [property]: { url } } } });
  return { ok: true, property, url };
}
