/**
 * ReviewLoop settings from the site config (da.live/config#/{org}/{site}):
 * - sheet `reviewloop`: key/value rows (worker-url, due-days, require-approval)
 * - sheet `reviewloop-types`: one row per review type (type, assignee, checklist, due-days)
 * Jira itself (site, project, token, statuses) is configured on the worker.
 */

export const DA_ADMIN = 'https://admin.da.live';
export const AEM_API = 'https://api.aem.live';

export const KEYS = ['worker-url', 'due-days', 'require-approval'];

export const DEFAULT_TYPES = [
  {
    name: 'Legal', assignee: '', checklist: ['Claims, rates and dates are accurate', 'Required disclaimers are present'], dueDays: 2,
  },
  {
    name: 'Brand', assignee: '', checklist: ['Tone of voice', 'Imagery and alt text'], dueDays: 2,
  },
  {
    name: 'Copy', assignee: '', checklist: ['Spelling and grammar', 'Headings and links'], dueDays: 1,
  },
];

function firstSheet(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.[':names'])) return json[json[':names'][0]]?.data || null;
  return null;
}

export function sheet(json, name) {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json[name])) return json[name];
  if (Array.isArray(json[name]?.data)) return json[name].data;
  if (json[':sheetname'] === name || json[':name'] === name) return firstSheet(json);
  return null;
}

function pick(row, ...names) {
  const key = Object.keys(row || {}).find((k) => names.includes(k.trim().toLowerCase()));
  return key === undefined ? '' : String(row[key] ?? '').trim();
}

function days(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? n : fallback;
}

/** "a; b\nc" → ["a", "b", "c"] */
export function splitList(value) {
  return String(value || '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Reads ReviewLoop settings from a DA site config response. */
export function parseConfig(json) {
  const settings = (sheet(json, 'reviewloop') || []).reduce((acc, row) => {
    const key = pick(row, 'key').toLowerCase();
    const value = pick(row, 'value');
    if (KEYS.includes(key) && value) acc[key] = value;
    return acc;
  }, {});
  const dueDays = days(settings['due-days'], 2);
  const types = (sheet(json, 'reviewloop-types') || []).map((row) => ({
    name: pick(row, 'type', 'name'),
    assignee: pick(row, 'assignee', 'reviewer'),
    checklist: splitList(pick(row, 'checklist')),
    dueDays: days(pick(row, 'due-days', 'due'), dueDays),
  })).filter((t) => t.name);
  return {
    workerUrl: settings['worker-url'] || '',
    requireApproval: /^(true|yes|1|on)$/i.test(settings['require-approval'] || ''),
    dueDays,
    types: types.length
      ? types
      : DEFAULT_TYPES.map((t) => ({ ...t, dueDays: t.dueDays ?? dueDays })),
    custom: types.length > 0,
  };
}

/** Lets ?worker-url=… override the sheet while testing. */
export function withQuery(config, search) {
  const params = new URLSearchParams(search);
  const url = params.get('worker-url');
  return url ? { ...config, workerUrl: url } : config;
}

export async function loadConfig(auth, { org, site }) {
  const urls = [`${DA_ADMIN}/config/${org}/${site}/`, `${AEM_API}/${org}/sites/${site}/config/editor/da.json`];
  for (let i = 0; i < urls.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await auth(urls[i]);
      // eslint-disable-next-line no-await-in-loop
      if (resp.ok) return parseConfig(await resp.json());
    } catch {
      // Try the next source.
    }
  }
  return parseConfig(null);
}

/** A due date `n` working days from `from`, as YYYY-MM-DD. */
export function dueDate(n, from = new Date()) {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}
