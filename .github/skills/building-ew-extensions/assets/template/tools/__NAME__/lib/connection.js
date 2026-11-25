/**
 * How the panel gets its data:
 *   worker  the site's worker holds the service secret and checks the author's sign-in
 *   demo    sample data, for trying the panel outside Experience Workspace and for tests
 * Both return the same shapes, so the panel does not care which one it has.
 */

import { normalizeItems } from './items.js';

export class ConnectionError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** getToken is called per request, so a refreshed IMS token is always used. */
export function workerConnection(workerUrl, getToken, page, fetchImpl = fetch) {
  const post = async (route, body = {}) => {
    let resp;
    try {
      resp = await fetchImpl(`${workerUrl}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...page, ...body }),
      });
    } catch {
      throw new ConnectionError(502, 'Could not reach the __TITLE__ worker. Check the worker-url setting.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new ConnectionError(resp.status, data.error || `The __TITLE__ worker answered ${resp.status}.`, data.code || '');
    }
    return data;
  };
  return {
    mode: 'worker',
    items: async () => normalizeItems((await post('items')).items),
  };
}

export function demoConnection(data) {
  return {
    mode: 'demo',
    items: async () => normalizeItems(data?.items),
  };
}
