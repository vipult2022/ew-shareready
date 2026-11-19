/**
 * The Airtable side of ReviewLoop: one record per review in a Reviews table, found by a
 * page key, with the round and the reviewed snapshot kept as JSON in a long-text field.
 * Reviewers comment on the record and change its Status (grid or kanban view).
 *
 * Airtable's free plan allows 1,000 API calls a month, so reads are cached for a few
 * seconds and the panel is told to check less often than it does for Jira.
 */

import { adfToMarkdown } from '../../lib/adf.js';
import { HttpError } from './http.js';
import {
  statusNames, stateByName, settle, fitProperty, newProp, resubmitProp, publishedProp, withOwn,
} from './review.js';

const API = 'https://api.airtable.com/v0';
const BASE_ID = /^app[a-zA-Z0-9]{14}$/;
const TABLE_ID = /^tbl[a-zA-Z0-9]{14}$/;
const RECORD_ID = /^rec[a-zA-Z0-9]{14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL = 20000;
const MAX_TEXT = 90000;
const MAX_COMMENT = 10000;

/** Column names in the Reviews table. "Status changed" and "Status changed by" are optional. */
export const FIELDS = {
  summary: 'Review',
  status: 'Status',
  type: 'Review type',
  reviewer: 'Reviewer',
  due: 'Due',
  page: 'Page',
  label: 'Page key',
  preview: 'Preview',
  edit: 'Edit in EW',
  live: 'Live page',
  description: 'Description',
  data: 'ReviewLoop data',
  changedAt: 'Status changed',
  changedBy: 'Status changed by',
};
export const OPTIONAL = [FIELDS.changedAt, FIELDS.changedBy];

const cache = new Map();
const tableIds = new Map();

export function resetAirtable() {
  cache.clear();
  tableIds.clear();
}

/** True when the worker has any Airtable settings, so it should offer Airtable at all. */
export function airtableConfigured(env = {}) {
  return ['AIRTABLE_BASE_ID', 'AIRTABLE_TOKEN'].some((k) => env[k]);
}

export function airtableConfig(env = {}) {
  const base = String(env.AIRTABLE_BASE_ID || '').trim();
  const table = String(env.AIRTABLE_TABLE || '').trim() || 'Reviews';
  const missing = [
    ['AIRTABLE_BASE_ID', base],
    ['AIRTABLE_TOKEN', env.AIRTABLE_TOKEN],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (base && !BASE_ID.test(base)) missing.push('AIRTABLE_BASE_ID (the app… id from the base URL)');
  return {
    base,
    table,
    token: String(env.AIRTABLE_TOKEN || '').trim(),
    statuses: statusNames(env, 'AIRTABLE'),
    missing,
  };
}

export function airtableSetupError(cfg) {
  return new HttpError(500, `The ReviewLoop worker is not connected to Airtable yet. Set ${cfg.missing.join(', ')}.`, { setup: true });
}

/** A short, stable name for a record, shown where Jira shows NWB-12. */
export function displayKey(recordId) {
  return `RL-${String(recordId).slice(-6).toUpperCase()}`;
}

function parseData(value) {
  try {
    const data = JSON.parse(value || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** "@[usrABC] please check" → "@Arjun Mehta please check" */
function commentText(comment) {
  const people = comment.mentioned || {};
  return String(comment.text || '').replace(/@\[(usr[a-zA-Z0-9]+)\]/g, (all, id) => (people[id]?.displayName ? `@${people[id].displayName}` : all));
}

/** The review as the EW panel and dialogs see it. */
export function toReview(record, comments, cfg, tableId = '') {
  const f = record.fields || {};
  const prop = parseData(f[FIELDS.data]);
  const status = f[FIELDS.status] || '';
  const { state, closedInTracker } = settle(stateByName(status, cfg.statuses) || 'review', prop);
  const approved = state === 'approved';
  const changedBy = f[FIELDS.changedBy];
  return {
    tracker: 'airtable',
    trackerName: 'Airtable',
    key: displayKey(record.id),
    id: record.id,
    url: tableId ? `https://airtable.com/${cfg.base}/${tableId}/${record.id}` : `https://airtable.com/${cfg.base}`,
    summary: f[FIELDS.summary] || '',
    status,
    state,
    reviewType: f[FIELDS.type] || prop.reviewType || '',
    due: f[FIELDS.due] || '',
    assignee: f[FIELDS.reviewer] ? { name: f[FIELDS.reviewer] } : null,
    round: prop.round || 1,
    snapshot: prop.snapshot || null,
    createdAt: record.createdTime || '',
    requestedAt: prop.requestedAt || record.createdTime || '',
    approvedAt: approved ? f[FIELDS.changedAt] || '' : '',
    approvedBy: approved ? changedBy?.name || f[FIELDS.reviewer] || '' : '',
    publishedAt: prop.publishedAt || '',
    closedInTracker,
    comments: withOwn((comments || [])
      .map((c) => ({
        id: String(c.id),
        author: c.author?.name || c.author?.email || 'Someone',
        created: c.createdTime,
        text: commentText(c).trim(),
      }))
      .sort((a, b) => String(a.created).localeCompare(String(b.created))), prop.own),
  };
}

function airtableError(cfg, status, data) {
  const type = data?.error?.type || (typeof data?.error === 'string' ? data.error : '');
  const message = String(data?.error?.message || '').slice(0, 300);
  if (status === 401) return new HttpError(502, 'Airtable rejected the worker’s token. Check AIRTABLE_TOKEN.', { setup: true });
  if (status === 403 || type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') {
    return new HttpError(502, `The Airtable token cannot use the “${cfg.table}” table in ${cfg.base}. Give the token access to that base, with the scopes in the README.`, { setup: true });
  }
  if (status === 404) return new HttpError(404, message || `Airtable could not find the “${cfg.table}” table. Run the setup script in the README.`);
  if (type === 'UNKNOWN_FIELD_NAME') return new HttpError(500, `The Airtable table is missing a column: ${message} Run the setup script in the README.`, { setup: true });
  if (status === 429 && /BILLING|LIMIT_EXCEEDED/.test(type)) {
    return new HttpError(429, 'This Airtable workspace has used its API calls for the month (1,000 on the free plan). Upgrade the workspace or wait for the next month.');
  }
  if (status === 429) return new HttpError(429, 'Airtable is busy. Try again in a minute.');
  return new HttpError(502, `Airtable answered ${status}${message ? `: ${message}` : '.'}`);
}

export function createAirtable(cfg) {
  if (cfg.missing.length) throw airtableSetupError(cfg);
  const table = `${cfg.base}/${encodeURIComponent(cfg.table)}`;

  async function call(method, path, body) {
    let resp;
    try {
      resp = await fetch(`${API}/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new HttpError(502, 'Could not reach Airtable.');
    }
    let data = {};
    try {
      data = await resp.json();
    } catch {
      // Airtable always answers JSON, but a proxy may not.
    }
    if (resp.ok) return data;
    throw airtableError(cfg, resp.status, data);
  }

  return {
    call,
    /** The base's tables, with their fields (needs the schema.bases:read scope). */
    async tables() {
      const data = await call('GET', `meta/bases/${cfg.base}/tables`);
      return data.tables || [];
    },
    /** All reviews of one page, newest first. */
    async find(label) {
      const formula = encodeURIComponent(`{${FIELDS.label}}='${label}'`);
      const data = await call('GET', `${table}?filterByFormula=${formula}&pageSize=100`);
      const newest = (a, b) => String(b.createdTime).localeCompare(String(a.createdTime));
      return (data.records || []).sort(newest);
    },
    async comments(id) {
      const data = await call('GET', `${table}/${id}/comments?pageSize=100`);
      return data.comments || [];
    },
    create(fields) {
      return call('POST', table, { fields, typecast: true });
    },
    update(id, fields) {
      return call('PATCH', `${table}/${id}`, { fields, typecast: true });
    },
    async addComment(id, text) {
      const data = await call('POST', `${table}/${id}/comments`, { text: text.slice(0, MAX_COMMENT) });
      return String(data.id || '');
    },
  };
}

/** Airtable as a ReviewLoop tracker, with the same methods as jiraTracker. */
export function airtableTracker(env) {
  const cfg = airtableConfig(env);
  const cacheId = (label) => `${cfg.base}|${cfg.table}|${label}`;
  let client;
  const at = () => {
    client = client || createAirtable(cfg);
    return client;
  };

  async function tableId() {
    if (TABLE_ID.test(cfg.table)) return cfg.table;
    const id = `${cfg.base}|${cfg.table}`;
    if (!tableIds.has(id)) {
      const found = (await at().tables().catch(() => []))
        .find((t) => t.name.toLowerCase() === cfg.table.toLowerCase());
      if (!found) return '';
      tableIds.set(id, found.id);
    }
    return tableIds.get(id);
  }

  async function review(record, comments) {
    return toReview(record, comments, cfg, await tableId());
  }

  /** The page's record, checked to belong to this page (so a key from elsewhere is refused). */
  async function ownRecord(label, key) {
    if (!RECORD_ID.test(key || '') && !/^RL-[A-Z0-9]{6}$/.test(key || '')) {
      throw new HttpError(400, 'The request is missing a valid review key.');
    }
    const record = (await at().find(label)).find((r) => r.id === key || displayKey(r.id) === key);
    if (!record) throw new HttpError(403, `${key} is not the review for this page.`);
    return record;
  }

  const save = (prop) => JSON.stringify(fitProperty(prop)).slice(0, MAX_TEXT);

  return {
    id: 'airtable',
    name: 'Airtable',
    poll: 60,
    missing: cfg.missing,
    setupError: () => airtableSetupError(cfg),
    owns: (key) => RECORD_ID.test(key || '') || /^RL-[A-Z0-9]{6}$/.test(key || ''),

    async status() {
      const tables = await at().tables();
      const wanted = cfg.table.toLowerCase();
      const found = tables.find((t) => t.id === cfg.table || t.name.toLowerCase() === wanted);
      if (!found) {
        throw new HttpError(500, `There is no “${cfg.table}” table in Airtable base ${cfg.base}. Run the setup script in the README.`, { setup: true });
      }
      tableIds.set(`${cfg.base}|${cfg.table}`, found.id);
      const names = (found.fields || []).map((fl) => fl.name);
      const missingFields = Object.values(FIELDS)
        .filter((n) => !OPTIONAL.includes(n) && !names.includes(n));
      const statusField = (found.fields || []).find((fl) => fl.name === FIELDS.status);
      const choices = (statusField?.options?.choices || []).map((c) => c.name);
      const known = choices.map((n) => n.toLowerCase());
      const missingStatuses = statusField
        ? Object.values(cfg.statuses).filter((n) => !known.includes(n.toLowerCase()))
        : [];
      return {
        base: cfg.base,
        table: found.name,
        tableId: found.id,
        url: `https://airtable.com/${cfg.base}/${found.id}`,
        ...(missingFields.length ? { missingFields } : {}),
        ...(missingStatuses.length ? { statuses: choices, missingStatuses } : {}),
      };
    },

    async latest(label) {
      const hit = cache.get(cacheId(label));
      if (hit && Date.now() - hit.at < CACHE_TTL) return hit.review;
      const [record] = await at().find(label);
      let result = null;
      if (record) {
        const prop = parseData(record.fields?.[FIELDS.data]);
        // A published review is only shown as closed, so skip its comments to save calls.
        const comments = prop.publishedAt ? [] : await at().comments(record.id);
        result = await review(record, comments);
      }
      cache.set(cacheId(label), { at: Date.now(), review: result });
      return result;
    },

    async create({
      label, page, urls, summary, description, due, assignee, reviewType, user, snapshot,
    }) {
      cache.delete(cacheId(label));
      const fields = {
        [FIELDS.summary]: summary,
        [FIELDS.status]: cfg.statuses.review,
        [FIELDS.type]: reviewType,
        [FIELDS.reviewer]: assignee,
        [FIELDS.page]: `${page.org}/${page.site}${page.path}`,
        [FIELDS.label]: label,
        [FIELDS.preview]: urls.previewUrl,
        [FIELDS.edit]: urls.editUrl,
        [FIELDS.description]: adfToMarkdown(description).slice(0, MAX_TEXT),
        [FIELDS.data]: save(newProp({
          page, reviewType, user, snapshot,
        })),
      };
      if (DATE.test(due || '')) fields[FIELDS.due] = due;
      const record = await at().create(fields);
      const result = await review(record, []);
      return {
        key: result.key, url: result.url, review: result, warnings: [],
      };
    },

    async resubmit({
      label, key, comment, text, user, snapshot,
    }) {
      cache.delete(cacheId(label));
      const record = await ownRecord(label, key);
      const prop = parseData(record.fields?.[FIELDS.data]);
      const id = await at().addComment(record.id, adfToMarkdown(comment, { plain: true }));
      const updated = await at().update(record.id, {
        [FIELDS.status]: cfg.statuses.review,
        [FIELDS.data]: save(resubmitProp(prop, {
          id, user, text, snapshot,
        })),
      });
      return review(updated, await at().comments(record.id));
    },

    async published({
      label, key, comment, user, liveUrl,
    }) {
      cache.delete(cacheId(label));
      const record = await ownRecord(label, key);
      const prop = parseData(record.fields?.[FIELDS.data]);
      const id = await at().addComment(record.id, adfToMarkdown(comment, { plain: true }));
      await at().update(record.id, {
        [FIELDS.status]: cfg.statuses.done,
        [FIELDS.live]: liveUrl,
        [FIELDS.data]: save(publishedProp(prop, { id, user, liveUrl })),
      });
      return { moved: true, warnings: [] };
    },
  };
}
