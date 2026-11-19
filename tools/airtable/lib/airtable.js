/**
 * Airtable Web API, read only. Used from the browser (personal access token) and from the
 * worker (team token), so it only needs a `call(path, params)` that returns parsed JSON.
 *
 * Records are read with cellFormat=string, so every value arrives the way Airtable shows it
 * (currency, percent, dates, linked record names) and the page matches what authors see.
 */

export const API = 'https://api.airtable.com/v0';
export const BASE_ID = /^app[a-zA-Z0-9]{14}$/;
export const TABLE_ID = /^tbl[a-zA-Z0-9]{14}$/;
export const VIEW_ID = /^viw[a-zA-Z0-9]{14}$/;
export const MAX_RECORDS = 300;
const PAGE_SIZE = 100;
// eslint-disable-next-line no-control-regex
const NAME = /^[^\u0000-\u001f]{1,255}$/;

export class AirtableError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A table or view may be given by id (tbl…, viw…) or by name. */
export function validRef(value, pattern) {
  const ref = String(value || '').trim();
  return pattern.test(ref) || NAME.test(ref) ? ref : '';
}

/** Plain-language errors for the Airtable statuses authors actually hit. */
export function airtableError(status, body = {}) {
  const type = body?.error?.type || (typeof body?.error === 'string' ? body.error : '') || '';
  const detail = body?.error?.message || '';
  if (status === 401) return new AirtableError(401, 'Airtable did not accept the token. Check it has not expired or been revoked.', 'token');
  if (status === 403) return new AirtableError(403, 'The token cannot read this base. In Airtable, open the token and add the base under Access.', 'access');
  if (status === 404) return new AirtableError(404, 'Airtable could not find that base, table or view. It may have been renamed or deleted.', 'missing');
  if (status === 422) return new AirtableError(422, `Airtable rejected the request${detail ? `: ${detail}` : ''}.`, type);
  if (status === 429 && /BILLING|PUBLIC_API_BILLING_LIMIT_EXCEEDED/i.test(type)) {
    return new AirtableError(429, 'This Airtable workspace has used its API calls for the month. Upgrade the plan or wait for the next month.', 'billing');
  }
  if (status === 429) return new AirtableError(429, 'Airtable is busy (5 requests a second per base). Try again in a moment.', 'rate');
  return new AirtableError(502, `Airtable answered ${status}${detail ? `: ${detail}` : ''}.`);
}

/** A `call` for a personal access token, straight from the browser or the worker. */
export function tokenCall(token, fetchImpl = fetch) {
  return async (path, params = {}) => {
    const url = new URL(`${API}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else if (value !== undefined && value !== '') url.searchParams.set(key, value);
    });
    let resp;
    try {
      resp = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new AirtableError(502, 'Could not reach Airtable. Check your connection and try again.');
    }
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw airtableError(resp.status, body);
    return body;
  };
}

/** Bases the token can read: [{ id, name }]. */
export async function listBases(call) {
  const bases = [];
  let offset;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await call('/meta/bases', offset ? { offset } : {});
    (page.bases || []).forEach((b) => bases.push({ id: b.id, name: b.name }));
    offset = page.offset;
  } while (offset && bases.length < 1000);
  return bases;
}

/** Tables with their fields and views, trimmed to what the panel needs. */
export async function listTables(call, base) {
  if (!BASE_ID.test(base || '')) throw new AirtableError(400, 'That is not an Airtable base id (app…).');
  const { tables = [] } = await call(`/meta/bases/${base}/tables`);
  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description || '',
    primaryFieldId: t.primaryFieldId,
    fields: (t.fields || []).map((f) => ({ id: f.id, name: f.name, type: f.type })),
    views: (t.views || []).filter((v) => ['grid', 'gallery', 'kanban', 'calendar', 'list'].includes(v.type) || !v.type)
      .map((v) => ({ id: v.id, name: v.name, type: v.type })),
  }));
}

/**
 * Up to `max` records of a table, in the view's order and filter when a view is given.
 * Returns { records: [{ id, fields }], more } with every value as Airtable's display string.
 */
export async function listRecords(call, base, table, {
  view = '', locale = 'en-us', timeZone = 'UTC', max = MAX_RECORDS,
} = {}) {
  if (!BASE_ID.test(base || '')) throw new AirtableError(400, 'That is not an Airtable base id (app…).');
  const tableRef = validRef(table, TABLE_ID);
  if (!tableRef) throw new AirtableError(400, 'Choose a table.');
  const viewRef = view ? validRef(view, VIEW_ID) : '';
  const limit = Math.max(1, Math.min(Number(max) || MAX_RECORDS, MAX_RECORDS));
  const records = [];
  let offset;
  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await call(`/${base}/${encodeURIComponent(tableRef)}`, {
      cellFormat: 'string',
      userLocale: locale,
      timeZone,
      pageSize: PAGE_SIZE,
      view: viewRef,
      offset,
    });
    (page.records || []).forEach((r) => records.push({ id: r.id, fields: r.fields || {} }));
    offset = page.offset;
  } while (offset && records.length < limit);
  return { records: records.slice(0, limit), more: !!offset || records.length > limit };
}
