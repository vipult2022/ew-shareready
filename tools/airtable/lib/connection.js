/**
 * How the panel reaches Airtable:
 *   worker  the site's worker holds a team token; authors need no Airtable account
 *   token   the author's own read-only personal access token, kept in this browser
 *   demo    sample Northwind data, for trying the panel outside Experience Workspace
 * All three return the same shapes, so the panel does not care which one it has.
 */

import {
  AirtableError, tokenCall, listBases, listTables, listRecords,
} from './airtable.js';

const TOKEN_KEY = 'ew-airtable:token';
const CACHE_TTL = 60000;
export const TOKEN_PATTERN = /^pat[a-zA-Z0-9]{14}\.[a-f0-9]{64}$/;

export function savedToken(storage = window.localStorage) {
  try {
    return storage?.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveToken(token, storage = window.localStorage) {
  try {
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lasts for this panel only.
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
  return { ...fn(memo), clear: () => cache.clear() };
}

function fromCall(call, mode, label) {
  return cached((memo) => ({
    mode,
    label,
    bases: (fresh) => memo('bases', () => listBases(call), fresh),
    tables: (base, fresh) => memo(`t|${base}`, () => listTables(call, base), fresh),
    records: (base, table, opts = {}, fresh = false) => memo(
      `r|${base}|${table}|${opts.view || ''}`,
      () => listRecords(call, base, table, opts),
      fresh,
    ),
  }));
}

export function tokenConnection(token, fetchImpl = fetch) {
  return fromCall(tokenCall(token, fetchImpl), 'token', 'Your Airtable token');
}

/** The team worker: same calls, checked against the author's Experience Workspace sign-in. */
export function workerConnection(workerUrl, getIms, page, fetchImpl = fetch) {
  const post = async (route, body = {}) => {
    let resp;
    try {
      resp = await fetchImpl(`${workerUrl}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getIms()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...page, ...body }),
      });
    } catch {
      throw new AirtableError(502, 'Could not reach the Airtable worker. Check the worker-url setting.');
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new AirtableError(resp.status, data.error || `The Airtable worker answered ${resp.status}.`, data.code || '');
    return data;
  };
  return cached((memo) => ({
    mode: 'worker',
    label: 'Team connection',
    bases: (fresh) => memo('bases', async () => (await post('bases')).bases, fresh),
    tables: (base, fresh) => memo(`t|${base}`, async () => (await post('tables', { base })).tables, fresh),
    records: (base, table, opts = {}, fresh = false) => memo(
      `r|${base}|${table}|${opts.view || ''}`,
      () => post('records', {
        base, table, view: opts.view, locale: opts.locale, timeZone: opts.timeZone, max: opts.max,
      }),
      fresh,
    ),
  }));
}

/** Sample data with the shapes of the Airtable API, for demo mode and tests. */
export function demoConnection(data) {
  const call = async (path) => {
    if (path === '/meta/bases') return { bases: data.bases };
    const tables = path.match(/^\/meta\/bases\/(app\w+)\/tables$/);
    if (tables) return { tables: data.tables[tables[1]] || [] };
    const [, base, table] = path.match(/^\/(app\w+)\/(.+)$/) || [];
    const list = data.tables[base] || [];
    const key = decodeURIComponent(table);
    const found = list.find((t) => t.id === key || t.name === key);
    if (!found) throw new AirtableError(404, 'Airtable could not find that base, table or view.');
    return { records: data.records[found.id] || [] };
  };
  return fromCall(call, 'demo', 'Sample data');
}
