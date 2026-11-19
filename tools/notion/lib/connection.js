/**
 * How the panel reaches Notion:
 *   worker  the site's worker holds the Notion integration secret (Notion's API does not
 *           accept calls from a browser, so this is the only live mode)
 *   demo    sample Northwind data, for trying the panel outside Experience Workspace
 * Both return the same shapes, so the panel does not care which one it has.
 */

const CACHE_TTL = 60000;

export class ConnectionError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cached(fn) {
  const cache = new Map();
  const memo = async (key, run, fresh = false) => {
    const hit = cache.get(key);
    if (!fresh && hit && hit.until > Date.now()) return hit.value;
    const value = await run();
    cache.set(key, { value, until: Date.now() + CACHE_TTL });
    return value;
  };
  return { ...fn(memo, cache), clear: () => cache.clear() };
}

/** The team worker, checked against the author's Experience Workspace sign-in. */
export function workerConnection(workerUrl, getIms, page, fetchImpl = fetch) {
  const send = async (route, body = {}) => {
    try {
      return await fetchImpl(`${workerUrl}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getIms()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...page, ...body }),
      });
    } catch {
      throw new ConnectionError(502, 'Could not reach the Notion worker. Check the worker-url setting.');
    }
  };
  const post = async (route, body) => {
    const resp = await send(route, body);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ConnectionError(resp.status, data.error || `The Notion worker answered ${resp.status}.`, data.code || '');
    return data;
  };
  return cached((memo, cache) => ({
    mode: 'worker',
    label: 'Team connection',
    databases: (fresh) => memo('dbs', async () => (await post('databases')).databases, fresh),
    database: (id, fresh) => memo(`db|${id}`, () => post('database', { database: id }), fresh),
    search: (query, fresh) => memo(`s|${query}`, () => post('search', { query }), fresh),
    page: (id, fresh) => memo(`p|${id}`, () => post('page', { page: id }), fresh),
    async link(id, url) {
      const result = await post('link', { page: id, url });
      [...cache.keys()].filter((k) => k.startsWith('db|') || k === `p|${id}`).forEach((k) => cache.delete(k));
      return result;
    },
    async file(url) {
      const resp = await send('file', { url });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new ConnectionError(resp.status, data.error || `The Notion worker answered ${resp.status}.`);
      }
      return resp.blob();
    },
  }));
}

/** Sample data with the worker's shapes, for demo mode and tests. */
export function demoConnection(data) {
  const all = () => Object.values(data.pages || {}).map((p) => p.page);
  const find = (id) => {
    const found = data.pages?.[id];
    if (!found) throw new ConnectionError(404, 'Notion could not find that page.');
    return found;
  };
  return cached((memo) => ({
    mode: 'demo',
    label: 'Sample data',
    databases: async () => data.databases || [],
    database: async (id) => {
      const database = (data.databases || []).find((d) => d.id.replace(/-/g, '') === id.replace(/-/g, ''));
      if (!database) throw new ConnectionError(404, 'Notion could not find that database.');
      const pages = all().filter((p) => p.database === database.id);
      return { database, pages, more: false };
    },
    search: async (query) => {
      const q = String(query || '').trim().toLowerCase();
      return { pages: all().filter((p) => !q || p.title.toLowerCase().includes(q)), more: false };
    },
    page: (id, fresh) => memo(`p|${id}`, async () => find(id), fresh),
    link: async () => {
      throw new ConnectionError(400, 'Sample mode does not write to Notion.');
    },
    file: async () => {
      throw new ConnectionError(400, 'Sample mode does not copy images.');
    },
  }));
}
