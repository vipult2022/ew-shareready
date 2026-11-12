/**
 * The Jira side of ReviewLoop: one issue per review, found by a page label, with the
 * round and the reviewed snapshot kept in an issue property. Uses Jira Cloud REST v3 with
 * an API token, so it works on the free plan and in team-managed projects.
 */

import { adfToText } from '../../lib/adf.js';
import { HttpError, sha256 } from './http.js';

export const PROPERTY = 'reviewloop';
const PROPERTY_BUDGET = 32000;
const OWN_LIMIT = 40;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,30}-\d{1,9}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,30}$/;
const FIELDS = ['summary', 'status', 'assignee', 'duedate', 'labels', 'comment', 'created'];

export const STATUS_DEFAULTS = {
  review: 'In review',
  changes: 'Changes requested',
  approved: 'Approved',
  done: 'Done',
};

function utf8Length(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function jiraConfig(env = {}) {
  const base = String(env.JIRA_BASE_URL || '').trim().replace(/\/+$/, '');
  const project = String(env.JIRA_PROJECT || '').trim().toUpperCase();
  const missing = [
    ['JIRA_BASE_URL', base],
    ['JIRA_PROJECT', project],
    ['JIRA_EMAIL', env.JIRA_EMAIL],
    ['JIRA_API_TOKEN', env.JIRA_API_TOKEN],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (base && !/^https:\/\/[^/]+$/.test(base)) missing.push('JIRA_BASE_URL (https://your-site.atlassian.net)');
  if (project && !PROJECT_KEY.test(project)) missing.push('JIRA_PROJECT (a project key such as NWB)');
  return {
    base,
    project,
    issueType: String(env.JIRA_ISSUE_TYPE || 'Task').trim(),
    statuses: {
      review: env.JIRA_STATUS_REVIEW || STATUS_DEFAULTS.review,
      changes: env.JIRA_STATUS_CHANGES || STATUS_DEFAULTS.changes,
      approved: env.JIRA_STATUS_APPROVED || STATUS_DEFAULTS.approved,
      done: env.JIRA_STATUS_DONE || STATUS_DEFAULTS.done,
    },
    missing,
    auth: missing.length ? '' : btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`),
  };
}

export function setupError(cfg) {
  return new HttpError(500, `The ReviewLoop worker is not connected to Jira yet. Set ${cfg.missing.join(', ')}.`, { setup: true });
}

/** The label that ties a Jira issue to one page. */
export async function pageLabel({ org, site, path }) {
  return `rl-${(await sha256(`${org}/${site}${path}`)).slice(0, 16)}`;
}

export function checkKey(key) {
  if (!ISSUE_KEY.test(key || '')) throw new HttpError(400, 'The request is missing a valid Jira issue key.');
  return key;
}

/** Which ReviewLoop state a Jira status means: review, changes, approved or done. */
export function stateOf(status, statuses = STATUS_DEFAULTS) {
  const name = String(status?.name || '').toLowerCase();
  const match = ['approved', 'changes', 'done', 'review'].find((s) => statuses[s].toLowerCase() === name);
  if (match) return match;
  return status?.statusCategory?.key === 'done' ? 'done' : 'review';
}

function lastMoveTo(changelog, statusName) {
  const target = statusName.toLowerCase();
  return (changelog?.histories || [])
    .filter((h) => (h.items || []).some((i) => i.field === 'status' && String(i.toString || '').toLowerCase() === target))
    .reduce((last, h) => (!last || h.created > last.created ? h : last), null);
}

/** The review as the EW panel and dialogs see it. */
export function toReview(issue, cfg) {
  const f = issue.fields || {};
  const prop = issue.properties?.[PROPERTY] || {};
  const own = prop.own || {};
  const state = stateOf(f.status, cfg.statuses);
  const approval = state === 'approved' ? lastMoveTo(issue.changelog, cfg.statuses.approved) : null;
  return {
    key: issue.key,
    url: `${cfg.base}/browse/${issue.key}`,
    summary: f.summary || '',
    status: f.status?.name || '',
    state,
    reviewType: prop.reviewType || '',
    due: f.duedate || '',
    assignee: f.assignee ? { name: f.assignee.displayName || 'Assigned' } : null,
    round: prop.round || 1,
    snapshot: prop.snapshot || null,
    requestedAt: prop.requestedAt || f.created || '',
    approvedAt: approval?.created || '',
    approvedBy: approval?.author?.displayName || '',
    comments: (f.comment?.comments || []).map((c) => {
      const mine = own[c.id];
      return {
        id: String(c.id),
        author: mine?.by || c.author?.displayName || 'Someone',
        created: c.created,
        text: mine ? mine.text : adfToText(c.body).trim(),
        own: Boolean(mine),
      };
    }),
  };
}

/** Keeps the property under Jira's 32 KB limit: drop the oldest own comments, then trim. */
export function fitProperty(value) {
  const fitted = { ...value, own: { ...(value.own || {}) } };
  const ownIds = Object.keys(fitted.own);
  ownIds.slice(0, Math.max(0, ownIds.length - OWN_LIMIT)).forEach((id) => delete fitted.own[id]);
  if (fitted.snapshot?.units) {
    fitted.snapshot = { ...fitted.snapshot, units: [...fitted.snapshot.units] };
    while (fitted.snapshot.units.length && utf8Length(fitted) > PROPERTY_BUDGET) {
      fitted.snapshot.units.pop();
      fitted.snapshot.complete = false;
    }
  }
  return fitted;
}

function jiraMessage(data) {
  const messages = [
    ...(data?.errorMessages || []),
    ...Object.entries(data?.errors || {}).map(([field, msg]) => `${field}: ${msg}`),
  ];
  return messages.join(' ').slice(0, 300);
}

const projectNames = new Map();

export function resetJira() {
  projectNames.clear();
}

export function createJira(cfg) {
  if (cfg.missing.length) throw setupError(cfg);

  async function call(method, path, body) {
    let resp;
    try {
      resp = await fetch(`${cfg.base}/rest/api/3${path}`, {
        method,
        headers: {
          Authorization: `Basic ${cfg.auth}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new HttpError(502, 'Could not reach Jira.');
    }
    if (resp.status === 204) return {};
    let data = {};
    try {
      data = await resp.json();
    } catch {
      // Some Jira answers have no body.
    }
    if (resp.ok) return data;
    const detail = jiraMessage(data);
    if (resp.status === 401) throw new HttpError(502, 'Jira rejected the worker’s credentials. Check JIRA_EMAIL and JIRA_API_TOKEN.', { setup: true });
    if (resp.status === 403) throw new HttpError(502, `The Jira account behind the worker is not allowed to do this in ${cfg.project}.`);
    if (resp.status === 404) throw new HttpError(404, detail || 'Not found in Jira.');
    if (resp.status === 429) throw new HttpError(429, 'Jira is busy. Try again in a minute.');
    throw new HttpError(502, `Jira answered ${resp.status}${detail ? `: ${detail}` : '.'}`, { jira: { status: resp.status, data } });
  }

  const jira = {
    call,
    async project() {
      const id = `${cfg.base}|${cfg.project}`;
      if (!projectNames.has(id)) {
        const data = await call('GET', `/project/${cfg.project}`);
        projectNames.set(id, data.name || cfg.project);
      }
      return { site: cfg.base, project: cfg.project, projectName: projectNames.get(id) };
    },
    async findKey(label) {
      const data = await call('POST', '/search/jql', {
        jql: `project = "${cfg.project}" AND labels = "${label}" ORDER BY created DESC`,
        maxResults: 1,
        fields: ['labels'],
      });
      return data.issues?.[0]?.key || null;
    },
    getIssue(key) {
      return call('GET', `/issue/${checkKey(key)}?fields=${FIELDS.join(',')}&properties=${PROPERTY}&expand=changelog`);
    },
    async setProperty(key, value) {
      await call('PUT', `/issue/${checkKey(key)}/properties/${PROPERTY}`, fitProperty(value));
    },
    async addComment(key, body) {
      const data = await call('POST', `/issue/${checkKey(key)}/comment`, { body });
      return String(data.id || '');
    },
    /** Moves the issue to a status by name. Returns false when no transition leads there. */
    async moveTo(key, statusName, current = '') {
      if (current && current.toLowerCase() === statusName.toLowerCase()) return true;
      const data = await call('GET', `/issue/${checkKey(key)}/transitions`);
      const target = statusName.toLowerCase();
      const t = (data.transitions || []).find((tr) => String(tr.to?.name || '').toLowerCase() === target)
        || (data.transitions || []).find((tr) => String(tr.name || '').toLowerCase() === target);
      if (!t) return false;
      await call('POST', `/issue/${key}/transitions`, { transition: { id: t.id } });
      return true;
    },
    async link(key, url, title) {
      await call('POST', `/issue/${checkKey(key)}/remotelink`, { globalId: `reviewloop:${url}`, object: { url, title } });
    },
    /** The Jira user to assign, matched by display name or email. Null when unsure. */
    async findAssignee(name) {
      const wanted = String(name || '').trim().toLowerCase();
      if (!wanted) return null;
      const users = await call('GET', `/user/assignable/search?project=${cfg.project}&query=${encodeURIComponent(wanted)}&maxResults=10`);
      const list = Array.isArray(users) ? users.filter((u) => u.active !== false) : [];
      const exact = list.find((u) => String(u.displayName || '').toLowerCase() === wanted
        || String(u.emailAddress || '').toLowerCase() === wanted);
      return (exact || (list.length === 1 ? list[0] : null))?.accountId || null;
    },
    /** Creates the issue; drops due date or assignee if the project's screen rejects them. */
    async createIssue(fields) {
      try {
        return await call('POST', '/issue', { fields });
      } catch (error) {
        const rejected = Object.keys(error.extra?.jira?.data?.errors || {});
        const optional = rejected.filter((f) => ['duedate', 'assignee'].includes(f));
        if (!optional.length || optional.length !== rejected.length) throw error;
        const retry = { ...fields };
        optional.forEach((f) => delete retry[f]);
        const created = await call('POST', '/issue', { fields: retry });
        return { ...created, dropped: optional };
      }
    },
  };
  return jira;
}
