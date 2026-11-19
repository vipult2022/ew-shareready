/**
 * The Jira side of ReviewLoop: one issue per review, found by a page label, with the
 * round and the reviewed snapshot kept in an issue property. Uses Jira Cloud REST v3 with
 * an API token, so it works on the free plan and in team-managed projects.
 */

import { adfToText } from '../../lib/adf.js';
import { HttpError } from './http.js';
import {
  STATUS_DEFAULTS, statusNames, stateByName, settle, fitProperty, newProp, resubmitProp,
  publishedProp, withOwn, pageLabel,
} from './review.js';

export {
  STATUS_DEFAULTS, fitProperty, pageLabel,
};

export const PROPERTY = 'reviewloop';
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,30}-\d{1,9}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,30}$/;
const FIELDS = ['summary', 'status', 'assignee', 'duedate', 'labels', 'comment', 'created'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the worker has any Jira settings, so it should offer Jira at all. */
export function jiraConfigured(env = {}) {
  return ['JIRA_BASE_URL', 'JIRA_PROJECT', 'JIRA_EMAIL', 'JIRA_API_TOKEN'].some((k) => env[k]);
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
    statuses: statusNames(env, 'JIRA'),
    missing,
    auth: missing.length ? '' : btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`),
  };
}

export function setupError(cfg) {
  return new HttpError(500, `The ReviewLoop worker is not connected to Jira yet. Set ${cfg.missing.join(', ')}.`, { setup: true });
}

export function isJiraKey(key) {
  return ISSUE_KEY.test(key || '');
}

export function checkKey(key) {
  if (!isJiraKey(key)) throw new HttpError(400, 'The request is missing a valid Jira issue key.');
  return key;
}

/** Which ReviewLoop state a Jira status means: review, changes, approved or done. */
export function stateOf(status, statuses = STATUS_DEFAULTS) {
  const match = stateByName(status?.name, statuses);
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
  const { state, closedInTracker } = settle(stateOf(f.status, cfg.statuses), prop);
  const closedTo = f.status?.name || cfg.statuses.done;
  const approval = state === 'approved'
    ? lastMoveTo(issue.changelog, cfg.statuses.approved)
      || (closedInTracker ? lastMoveTo(issue.changelog, closedTo) : null)
    : null;
  return {
    tracker: 'jira',
    trackerName: 'Jira',
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
    createdAt: f.created || '',
    requestedAt: prop.requestedAt || f.created || '',
    approvedAt: approval?.created || '',
    approvedBy: approval?.author?.displayName || '',
    publishedAt: prop.publishedAt || '',
    closedInTracker,
    // Older panels read this name.
    closedInJira: closedInTracker,
    comments: withOwn((f.comment?.comments || []).map((c) => ({
      id: String(c.id),
      author: c.author?.displayName || 'Someone',
      created: c.created,
      text: adfToText(c.body).trim(),
    })), prop.own),
  };
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
    /** Status names used by the project's workflows, to spot a missing column early. */
    async statuses() {
      const data = await call('GET', `/project/${cfg.project}/statuses`);
      const types = Array.isArray(data) ? data : [];
      const names = types.flatMap((t) => (t.statuses || []).map((st) => st.name));
      return [...new Set(names.filter(Boolean))];
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
      if (!t) {
        jira.available = [...new Set((data.transitions || []).map((tr) => tr.to?.name || tr.name))];
        return false;
      }
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

/**
 * Jira as a ReviewLoop tracker. Every tracker has the same methods, which take plain
 * values and return reviews as the panel sees them.
 */
export function jiraTracker(env) {
  const cfg = jiraConfig(env);
  let client;
  const jira = () => {
    client = client || createJira(cfg);
    return client;
  };
  const review = async (key) => toReview(await jira().getIssue(key), cfg);

  /** The page's issue, checked to belong to this page (so a key from elsewhere is refused). */
  async function ownIssue(label, key) {
    const issue = await jira().getIssue(checkKey(key));
    if (!(issue.fields?.labels || []).includes(label)) {
      throw new HttpError(403, `${key} is not the review for this page.`);
    }
    return issue;
  }

  return {
    id: 'jira',
    name: 'Jira',
    poll: 15,
    missing: cfg.missing,
    setupError: () => setupError(cfg),
    owns: isJiraKey,

    async status() {
      const [project, names] = await Promise.all([
        jira().project(),
        jira().statuses().catch(() => null),
      ]);
      const known = (names || []).map((n) => n.toLowerCase());
      const missingStatuses = names
        ? Object.values(cfg.statuses).filter((n) => !known.includes(n.toLowerCase()))
        : [];
      return missingStatuses.length ? { ...project, statuses: names, missingStatuses } : project;
    },

    async latest(label) {
      const key = await jira().findKey(label);
      return key ? review(key) : null;
    },

    async create({
      label, page, urls, summary, description, due, assignee, reviewType, user, snapshot,
    }) {
      const accountId = await jira().findAssignee(assignee).catch(() => null);
      const fields = {
        project: { key: cfg.project },
        issuetype: { name: cfg.issueType },
        summary,
        description,
        labels: ['reviewloop', label],
      };
      if (DATE.test(due || '')) fields.duedate = due;
      if (accountId) fields.assignee = { accountId };
      const created = await jira().createIssue(fields);
      const { key } = created;
      await jira().setProperty(key, newProp({
        page, reviewType, user, snapshot,
      }));
      const moved = await jira().moveTo(key, cfg.statuses.review);
      await Promise.allSettled([
        jira().link(key, urls.editUrl, 'Edit in Experience Workspace'),
        jira().link(key, urls.previewUrl, 'Preview'),
      ]);
      const warnings = [];
      if (!moved) {
        const options = (jira().available || []).join(', ');
        warnings.push(`No transition to “${cfg.statuses.review}”, so the issue stayed in its first status. Add that status to the board${options ? ` (it can move to: ${options})` : ''}, or set JIRA_STATUS_REVIEW on the worker.`);
      }
      if (assignee && !accountId) warnings.push(`No Jira user called “${assignee}”, so the issue is unassigned.`);
      (created.dropped || []).forEach((f) => warnings.push(`The project does not allow ${f === 'duedate' ? 'a due date' : 'an assignee'} on new issues.`));
      const result = await review(key);
      return {
        key, url: result.url, review: result, warnings,
      };
    },

    async resubmit({
      label, key, comment, text, user, snapshot,
    }) {
      const issue = await ownIssue(label, key);
      const prop = issue.properties?.[PROPERTY] || {};
      const id = await jira().addComment(issue.key, comment);
      await jira().setProperty(issue.key, resubmitProp(prop, {
        id, user, text, snapshot,
      }));
      await jira().moveTo(issue.key, cfg.statuses.review, issue.fields?.status?.name);
      return review(issue.key);
    },

    async published({
      label, key, comment, user, liveUrl,
    }) {
      const issue = await ownIssue(label, key);
      const prop = issue.properties?.[PROPERTY] || {};
      const id = await jira().addComment(issue.key, comment);
      await jira().setProperty(issue.key, publishedProp(prop, { id, user, liveUrl }));
      await jira().link(issue.key, liveUrl, 'Live page').catch(() => null);
      const moved = await jira().moveTo(issue.key, cfg.statuses.done, issue.fields?.status?.name);
      return { moved, warnings: moved ? [] : [`No transition to “${cfg.statuses.done}”.`] };
    },
  };
}
