/**
 * How the panel reaches the designs:
 *   worker  the site's worker, where the Figma plugin drops each handoff
 *   demo    a sample Northwind handoff, for trying the panel without Figma
 * Both return the same shapes, so the panel does not care which one it has.
 */

const CACHE_TTL = 30000;

export class ConnectionError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The team worker, checked against the author's Experience Workspace sign-in. */
export function workerConnection(workerUrl, getIms, site, fetchImpl = fetch) {
  const cache = new Map();
  const send = async (route, body = {}) => {
    try {
      return await fetchImpl(`${workerUrl}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getIms()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...site, ...body }),
      });
    } catch {
      throw new ConnectionError(502, 'Could not reach the Figma worker. Check the worker-url setting.');
    }
  };
  const post = async (route, body) => {
    const resp = await send(route, body);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ConnectionError(resp.status, data.error || `The Figma worker answered ${resp.status}.`, data.code || '');
    return data;
  };
  return {
    mode: 'worker',
    label: 'Team inbox',
    list: async () => (await post('handoffs')).handoffs || [],
    async get(id, fresh = false) {
      const hit = cache.get(id);
      if (!fresh && hit && hit.until > Date.now()) return hit.value;
      const value = (await post('handoff', { id })).handoff;
      cache.set(id, { value, until: Date.now() + CACHE_TTL });
      return value;
    },
    async image(id, image) {
      const resp = await send('image', { id, image });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new ConnectionError(resp.status, data.error || `The Figma worker answered ${resp.status}.`);
      }
      return resp.blob();
    },
    status: (id, status, url = '') => post('status', { id, status, url }),
  };
}

/** Sample data with the worker's shapes. `base` is where the sample pictures live. */
export function demoConnection(handoffs, { base = '', fetchImpl = fetch } = {}) {
  const list = handoffs.map((h) => ({ ...h, status: h.status || 'new' }));
  const find = (id) => {
    const found = list.find((h) => h.id === id);
    if (!found) throw new ConnectionError(404, 'That design is no longer in the inbox.');
    return found;
  };
  const summary = ({ tree, ...rest }) => rest;
  return {
    mode: 'demo',
    label: 'Sample design',
    list: async () => list.map(summary),
    get: async (id) => find(id),
    async image(id, image) {
      const file = find(id).files?.[image];
      if (!file) throw new ConnectionError(404, 'That picture is not in the sample.');
      const resp = await fetchImpl(new URL(file, base).href);
      if (!resp.ok) throw new ConnectionError(resp.status, 'Could not load the sample picture.');
      return resp.blob();
    },
    async status(id, status, url = '') {
      Object.assign(find(id), { status, url, updated: new Date().toISOString() });
      return { ok: true, demo: true };
    },
  };
}
