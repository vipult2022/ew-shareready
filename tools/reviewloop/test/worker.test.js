/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { resetState, allowedOrigin, validatePage } from '../worker/src/http.js';
import {
  resetJira, stateOf, fitProperty, jiraConfig, pageLabel,
} from '../worker/src/jira.js';
import { resetAirtable, displayKey } from '../worker/src/airtable.js';
import { reviewDescription, rereviewComment, publishedComment } from '../lib/adf.js';

const JIRA = 'https://northwind.atlassian.net';
const ENV = {
  ALLOWED_ORGS: 'northwind',
  JIRA_BASE_URL: JIRA,
  JIRA_PROJECT: 'NWB',
  JIRA_EMAIL: 'bot@northwind.example',
  JIRA_API_TOKEN: 'secret',
};
const PAGE = { org: 'northwind', site: 'website', path: '/offers/spring-savings' };
const SNAPSHOT = { v: 1, units: [['heading', 'Page title (H1)', 'Spring Savings', '', '', '']], complete: true };
const STATUSES = ['To Do', 'In review', 'Changes requested', 'Approved', 'Done'];

let jira;
let airtable;
let calls;
let daStatus;
const realFetch = globalThis.fetch;
const PREVIEWED = 'Thu, 12 Nov 2026 18:00:00 GMT';

function fakeJira() {
  const issues = new Map();
  let next = 1;
  let commentId = 100;
  const users = [{ accountId: 'acc-arjun', displayName: 'Arjun Mehta', active: true }];
  const stamp = () => new Date(Date.now() + commentId * 1000).toISOString();
  const move = (issue, to, author = 'Arjun Mehta') => {
    issue.changelog.histories.push({
      created: new Date().toISOString(),
      author: { displayName: author },
      items: [{ field: 'status', fromString: issue.fields.status.name, toString: to }],
    });
    issue.fields.status = { name: to, statusCategory: { key: to === 'Done' ? 'done' : 'indeterminate' } };
  };
  return {
    issues,
    users,
    move,
    reviewerComment(key, text) {
      commentId += 1;
      issues.get(key).fields.comment.comments.push({
        id: String(commentId),
        author: { displayName: 'Arjun Mehta' },
        created: stamp(),
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      });
    },
    handle(method, path, body) {
      if (method === 'GET' && path === '/project/NWB') return { name: 'Northwind Web' };
      if (method === 'GET' && path === '/project/NWB/statuses') {
        return [{ name: 'Task', statuses: STATUSES.map((name) => ({ name })) }];
      }
      if (method === 'POST' && path === '/search/jql') {
        const label = body.jql.match(/labels = "([^"]+)"/)[1];
        const found = [...issues.values()]
          .filter((i) => i.fields.labels.includes(label))
          .reverse();
        return { issues: found.slice(0, body.maxResults).map((i) => ({ key: i.key })) };
      }
      if (method === 'GET' && path.startsWith('/user/assignable/search')) {
        const q = new URL(`https://x${path}`).searchParams.get('query');
        return users.filter((u) => u.displayName.toLowerCase().includes(q));
      }
      if (method === 'POST' && path === '/issue') {
        const key = `NWB-${next}`;
        next += 1;
        const { fields } = body;
        issues.set(key, {
          key,
          fields: {
            summary: fields.summary,
            labels: fields.labels,
            duedate: fields.duedate || null,
            assignee: users.find((u) => u.accountId === fields.assignee?.accountId) || null,
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            created: stamp(),
            comment: { comments: [] },
          },
          description: fields.description,
          properties: {},
          links: [],
          changelog: { histories: [] },
        });
        return { key };
      }
      const m = path.match(/^\/issue\/([A-Z]+-\d+)(\/[a-z]+)?(\/[a-z]+)?/);
      const issue = m && issues.get(m[1]);
      if (!issue) return { status: 404, data: { errorMessages: ['Issue does not exist'] } };
      if (method === 'GET' && !m[2]) return JSON.parse(JSON.stringify(issue));
      if (method === 'PUT' && m[2] === '/properties') {
        issue.properties[m[3].slice(1)] = body;
        return { status: 204 };
      }
      if (method === 'POST' && m[2] === '/comment') {
        commentId += 1;
        issue.fields.comment.comments.push({
          id: String(commentId), author: { displayName: 'ReviewLoop bot' }, created: stamp(), body: body.body,
        });
        return { id: String(commentId) };
      }
      if (method === 'GET' && m[2] === '/transitions') {
        const transitions = STATUSES.map((s, i) => ({ id: `${i + 1}`, name: s, to: { name: s } }));
        return { transitions };
      }
      if (method === 'POST' && m[2] === '/transitions') {
        move(issue, STATUSES[Number(body.transition.id) - 1], 'ReviewLoop bot');
        return { status: 204 };
      }
      if (method === 'POST' && m[2] === '/remotelink') {
        issue.links.push(body);
        return { id: issue.links.length };
      }
      return { status: 404, data: { errorMessages: [`No route ${method} ${path}`] } };
    },
  };
}

const AT_BASE = 'appNorthwindBank1';
const AT_TABLE = 'tblReviews0000001';
const AT_ENV = {
  ALLOWED_ORGS: 'northwind', AIRTABLE_BASE_ID: AT_BASE, AIRTABLE_TOKEN: 'pat-secret',
};
const AT_FIELDS = ['Review', 'Status', 'Review type', 'Reviewer', 'Due', 'Page', 'Page key',
  'Preview', 'Edit in EW', 'Live page', 'Description', 'ReviewLoop data'];

function fakeAirtable() {
  const records = new Map();
  let next = 1;
  let commentId = 1;
  let clock = Date.parse('2026-11-12T10:00:00Z');
  const tick = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const fields = AT_FIELDS.map((name) => (name === 'Status'
    ? { name, options: { choices: ['In review', 'Changes requested', 'Approved', 'Done'].map((n) => ({ name: n })) } }
    : { name }));
  const self = {
    records,
    fields,
    calls: 0,
    limit: false,
    /** The reviewer changes Status in Airtable; the optional "Status changed" fields follow. */
    move(id, to, by = 'Arjun Mehta') {
      const record = records.get(id);
      record.fields.Status = to;
      record.fields['Status changed'] = tick();
      record.fields['Status changed by'] = { id: 'usrArjun', name: by };
    },
    reviewerComment(id, text) {
      commentId += 1;
      records.get(id).comments.push({
        id: `com${commentId}`,
        author: { id: 'usrArjun', name: 'Arjun Mehta' },
        createdTime: tick(),
        text,
        mentioned: { usrPriya: { displayName: 'Priya Shah' } },
      });
    },
    handle(method, path, body) {
      self.calls += 1;
      if (self.limit) return { status: 429, data: { errors: [{ error: 'PUBLIC_API_BILLING_LIMIT_EXCEEDED' }], error: { type: 'PUBLIC_API_BILLING_LIMIT_EXCEEDED' } } };
      if (method === 'GET' && path === `meta/bases/${AT_BASE}/tables`) {
        return { tables: [{ id: AT_TABLE, name: 'Reviews', fields }] };
      }
      const url = new URL(`https://x/${path}`);
      const [base, table, id, sub] = url.pathname.slice(1).split('/');
      if (base !== AT_BASE || decodeURIComponent(table) !== 'Reviews') return { status: 404, data: { error: 'NOT_FOUND' } };
      const copy = (r) => ({ id: r.id, createdTime: r.createdTime, fields: { ...r.fields } });
      if (method === 'GET' && !id) {
        const label = url.searchParams.get('filterByFormula').match(/\{Page key\}='([^']+)'/)[1];
        return { records: [...records.values()].filter((r) => r.fields['Page key'] === label).map(copy) };
      }
      if (method === 'POST' && !id) {
        const unknown = Object.keys(body.fields).find((n) => !fields.some((f) => f.name === n));
        if (unknown) return { status: 422, data: { error: { type: 'UNKNOWN_FIELD_NAME', message: `Unknown field name: "${unknown}"` } } };
        const rid = `recNorthwind${String(next).padStart(5, '0')}`;
        next += 1;
        records.set(rid, {
          id: rid, createdTime: tick(), fields: { ...body.fields }, comments: [],
        });
        return copy(records.get(rid));
      }
      const record = records.get(id);
      if (!record) return { status: 404, data: { error: 'NOT_FOUND' } };
      if (method === 'PATCH' && !sub) {
        if (body.fields.Status && body.fields.Status !== record.fields.Status) {
          self.move(id, body.fields.Status, 'ReviewLoop bot');
        }
        Object.assign(record.fields, body.fields);
        return copy(record);
      }
      if (method === 'GET' && sub === 'comments') return { comments: [...record.comments].reverse(), offset: null };
      if (method === 'POST' && sub === 'comments') {
        commentId += 1;
        const comment = {
          id: `com${commentId}`, author: { id: 'usrBot', name: 'ReviewLoop bot' }, createdTime: tick(), text: body.text,
        };
        record.comments.push(comment);
        return comment;
      }
      return { status: 404, data: { error: 'NOT_FOUND' } };
    },
  };
  return self;
}

beforeEach(() => {
  resetState();
  resetJira();
  resetAirtable();
  jira = fakeJira();
  airtable = fakeAirtable();
  calls = [];
  daStatus = 200;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    calls.push({ url, init });
    if (url.startsWith('https://admin.da.live/source/')) return new Response(null, { status: daStatus });
    if (url.startsWith('https://api.aem.live/')) return new Response(null, { status: 404 });
    if (url.startsWith('https://ims-na1.adobelogin.com/')) return Response.json({ displayName: 'Priya Shah' });
    const page = url.match(/^https:\/\/main--website--northwind\.aem\.(page|live)\/offers\/(spring-savings|bare)(\.plain\.html)?\?rl=[a-z0-9]+$/);
    if (page) {
      const [, host, name, isPlain] = page;
      const h1 = `<h1>Spring Savings: earn ${host === 'page' ? '4.50' : '4.25'}% APY</h1>`;
      // Like the real CDN: the full page is fresh, a cached .plain.html may lag behind.
      let text = isPlain ? '<h1>Spring Savings: earn 4.00% APY</h1>' : `<html><head></head><body><main>\n${h1}\n</main></body></html>`;
      if (name === 'bare') text = isPlain ? h1 : '<html><body>no main</body></html>';
      return new Response(text, { headers: { 'Last-Modified': PREVIEWED } });
    }
    if (url.includes('.aem.')) return new Response('', { status: 404 });
    if (url.startsWith('https://api.airtable.com/v0/')) {
      assert.equal(init.headers.Authorization, 'Bearer pat-secret');
      const out = airtable.handle(method, url.slice('https://api.airtable.com/v0/'.length), init.body ? JSON.parse(init.body) : null);
      if (out?.status) return Response.json(out.data, { status: out.status });
      return Response.json(out);
    }
    if (url.startsWith(`${JIRA}/rest/api/3`)) {
      assert.equal(init.headers.Authorization, `Basic ${btoa('bot@northwind.example:secret')}`);
      const out = jira.handle(method, url.slice(`${JIRA}/rest/api/3`.length), init.body ? JSON.parse(init.body) : null);
      if (out?.status === 204) return new Response(null, { status: 204 });
      if (out?.status) return Response.json(out.data, { status: out.status });
      return Response.json(out);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function call(path, body, { token = 'tok', origin = 'https://main--website--northwind.aem.page', env = ENV } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://rl.example.workers.dev${path}`, body
    ? { method: 'POST', headers, body: JSON.stringify(body) }
    : { headers: { Origin: origin } });
  return worker.fetch(req, env).then(async (resp) => ({
    status: resp.status, data: await resp.json(), headers: resp.headers,
  }));
}

const page = {
  ...PAGE,
  title: 'Spring Savings',
  previewUrl: 'https://main--website--northwind.aem.page/offers/spring-savings',
  editUrl: 'https://da.live/canvas#/northwind/website/offers/spring-savings',
  liveUrl: 'https://main--website--northwind.aem.live/offers/spring-savings',
};

function createBody(extra = {}) {
  return {
    ...PAGE,
    summary: 'Legal review: Spring Savings',
    reviewType: 'Legal',
    assignee: 'Arjun Mehta',
    due: '2026-11-14',
    description: reviewDescription({ page, requester: 'Priya Shah', changes: [] }),
    snapshot: SNAPSHOT,
    ...extra,
  };
}

test('status: names the Jira project, or says what to set up', async () => {
  const ok = await call('/status');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.jira, { site: JIRA, project: 'NWB', projectName: 'Northwind Web' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://main--website--northwind.aem.page');
  const renamed = await call('/status', null, { env: { ...ENV, JIRA_STATUS_REVIEW: 'Legal review' } });
  assert.deepEqual(renamed.data.jira.missingStatuses, ['Legal review']);
  assert.ok(renamed.data.jira.statuses.includes('In review'));
  const missing = await call('/status', null, { env: { ...ENV, JIRA_API_TOKEN: '' } });
  assert.equal(missing.status, 500);
  assert.equal(missing.data.setup, true);
  assert.match(missing.data.error, /JIRA_API_TOKEN/);
});

test('origins, page checks and IMS access are enforced', async () => {
  assert.equal(allowedOrigin('https://evil.example.com'), null);
  assert.equal((await call('/status', null, { origin: 'https://evil.example.com' })).status, 403);
  assert.throws(() => validatePage({ ...PAGE, path: '/a/../b' }), /not valid|valid org/);
  assert.equal((await call('/review/get', PAGE, { token: '' })).status, 401);
  assert.equal((await call('/review/get', { ...PAGE, org: 'other' })).status, 403);
  daStatus = 403;
  assert.equal((await call('/review/get', PAGE)).status, 403);
});

test('page: returns preview and live, live empty for a first version', async () => {
  const both = await call('/page', PAGE);
  assert.match(both.data.preview, /4\.50%/);
  assert.match(both.data.live, /4\.25%/);
  assert.equal(both.data.preview, '<h1>Spring Savings: earn 4.50% APY</h1>', 'from the page, not a stale .plain.html');
  const bare = await call('/page', { ...PAGE, path: '/offers/bare' });
  assert.match(bare.data.preview, /4\.50%/, 'falls back to .plain.html without <main>');
  const fresh = await call('/page', { ...PAGE, path: '/offers/new' });
  assert.equal(fresh.status, 404);
  assert.match(fresh.data.error, /no preview yet/);
});

test('page: flags a preview older than the one the author just made', async () => {
  const current = await call('/page', { ...PAGE, since: PREVIEWED });
  assert.equal(current.data.stale, false);
  const old = await call('/page', { ...PAGE, since: 'Thu, 12 Nov 2026 18:05:00 GMT' });
  assert.equal(old.data.stale, true);
  assert.equal(calls.filter((c) => c.url.includes('.aem.page/')).length, 3);
  assert.ok(calls.filter((c) => c.url.includes('.aem.')).every((c) => /[?]rl=/.test(c.url)));
});

test('full loop: create, reviewer comments, resubmit, approve, publish', async () => {
  const none = await call('/review/get', PAGE);
  assert.equal(none.data.review, null);
  assert.equal(none.data.user, 'Priya Shah');

  const created = await call('/review/create', createBody());
  assert.equal(created.status, 200, created.data.error);
  assert.equal(created.data.key, 'NWB-1');
  assert.equal(created.data.url, `${JIRA}/browse/NWB-1`);
  assert.deepEqual(created.data.warnings, []);
  const { review } = created.data;
  assert.equal(review.state, 'review');
  assert.equal(review.status, 'In review');
  assert.equal(review.assignee.name, 'Arjun Mehta');
  assert.equal(review.reviewType, 'Legal');
  assert.equal(review.due, '2026-11-14');
  assert.equal(review.round, 1);
  assert.deepEqual(review.snapshot, SNAPSHOT);
  const issue = jira.issues.get('NWB-1');
  assert.ok(issue.fields.labels.includes(await pageLabel(PAGE)));
  assert.deepEqual(issue.links.map((l) => l.object.title), ['Edit in Experience Workspace', 'Preview']);
  assert.equal(issue.properties.reviewloop.requester, 'Priya Shah');

  const again = await call('/review/create', createBody());
  assert.equal(again.status, 409);

  jira.reviewerComment('NWB-1', 'Please add “(variable rate)” after the APY.');
  jira.move(issue, 'Changes requested');
  const changes = (await call('/review/get', PAGE)).data.review;
  assert.equal(changes.state, 'changes');
  assert.deepEqual(changes.comments.map((c) => [c.author, c.own]), [['Arjun Mehta', false]]);
  assert.match(changes.comments[0].text, /variable rate/);

  const resent = await call('/review/resubmit', {
    ...PAGE,
    key: 'NWB-1',
    text: 'Added the variable-rate wording.',
    comment: rereviewComment({
      page, requester: 'Priya Shah', changes: [], round: 2,
    }),
    snapshot: { ...SNAPSHOT, units: [...SNAPSHOT.units, ['text', 'Top of page', 'variable rate', '', '', '']] },
  });
  assert.equal(resent.status, 200, resent.data.error);
  assert.equal(resent.data.review.round, 2);
  assert.equal(resent.data.review.state, 'review');
  assert.equal(resent.data.review.snapshot.units.length, 2);
  const mine = resent.data.review.comments.at(-1);
  assert.deepEqual([mine.author, mine.text, mine.own], ['Priya Shah', 'Added the variable-rate wording.', true]);

  jira.move(issue, 'Approved');
  const approved = (await call('/review/get', PAGE)).data.review;
  assert.equal(approved.state, 'approved');
  assert.equal(approved.approvedBy, 'Arjun Mehta');
  assert.ok(approved.approvedAt);

  const published = await call('/review/published', {
    ...PAGE, key: 'NWB-1', comment: publishedComment({ liveUrl: page.liveUrl, publisher: 'Priya Shah' }),
  });
  assert.equal(published.status, 200, published.data.error);
  assert.equal(published.data.moved, true);
  const done = (await call('/review/get', PAGE)).data.review;
  assert.equal(done.state, 'done');
  assert.equal(done.comments.at(-1).text, `Published: ${page.liveUrl}`);
  assert.ok(issue.links.some((l) => l.object.title === 'Live page'));

  const next = await call('/review/create', createBody());
  assert.equal(next.data.key, 'NWB-2', 'a new review once the last one is done');
});

test('a reviewer who closes the issue to Done has approved it, until it is published', async () => {
  await call('/review/create', createBody());
  const issue = jira.issues.get('NWB-1');
  jira.move(issue, 'Done');
  const closed = (await call('/review/get', PAGE)).data.review;
  assert.equal(closed.state, 'approved');
  assert.equal(closed.approvedBy, 'Arjun Mehta');
  assert.ok(closed.approvedAt);
  assert.equal(closed.closedInTracker, true);
  await call('/review/published', {
    ...PAGE, key: 'NWB-1', comment: publishedComment({ liveUrl: 'https://x.aem.live/', publisher: 'Priya Shah' }),
  });
  assert.equal((await call('/review/get', PAGE)).data.review.state, 'done');
});

test('unknown assignee leaves the issue unassigned with a warning', async () => {
  const created = await call('/review/create', createBody({ assignee: 'Nobody Here' }));
  assert.equal(created.status, 200);
  assert.equal(created.data.review.assignee, null);
  assert.match(created.data.warnings[0], /No Jira user called “Nobody Here”/);
});

test('an issue from another page cannot be commented on', async () => {
  await call('/review/create', createBody());
  const other = { ...PAGE, path: '/about' };
  const res = await call('/review/published', {
    ...other, key: 'NWB-1', comment: publishedComment({ liveUrl: 'x' }),
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /not the review for this page/);
  const bad = await call('/review/resubmit', { ...PAGE, key: 'NWB-1', comment: { type: 'doc' } });
  assert.equal(bad.status, 400);
});

test('helpers: status mapping, config and property size', () => {
  assert.equal(stateOf({ name: 'approved' }), 'approved');
  assert.equal(stateOf({ name: 'Closed', statusCategory: { key: 'done' } }), 'done');
  assert.equal(stateOf({ name: 'To Do', statusCategory: { key: 'new' } }), 'review');
  const insecure = jiraConfig({ ...ENV, JIRA_BASE_URL: 'http://x' });
  assert.deepEqual(insecure.missing, ['JIRA_BASE_URL (https://your-site.atlassian.net)']);
  const big = {
    snapshot: { v: 1, units: Array.from({ length: 200 }, (_, i) => ['text', `Row ${i}`, '€'.repeat(300), '', '', '']), complete: true },
    own: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i), { by: 'A', text: 'B' }])),
  };
  const fitted = fitProperty(big);
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 32000);
  assert.equal(fitted.snapshot.complete, false);
  assert.equal(Object.keys(fitted.own).length, 40);
  assert.equal(big.snapshot.units.length, 200, 'input untouched');
});

/* Airtable */

const BOTH = { ...ENV, ...AT_ENV };
const reviewOf = async (body = PAGE, env = AT_ENV) => (await call('/review/get', body, { env })).data;

test('airtable status: base and table, missing fields, and both trackers listed', async () => {
  const ok = await call('/status', null, { env: BOTH });
  assert.equal(ok.status, 200, ok.data.error);
  assert.equal(ok.data.default, 'jira');
  assert.deepEqual(ok.data.trackers.map((t) => [t.id, t.ready]), [['jira', true], ['airtable', true]]);
  assert.deepEqual(ok.data.airtable, {
    base: AT_BASE, table: 'Reviews', tableId: AT_TABLE, url: `https://airtable.com/${AT_BASE}/${AT_TABLE}`,
  });
  assert.equal(ok.data.jira.project, 'NWB');

  const preferred = await call('/status', null, { env: { ...BOTH, DEFAULT_TRACKER: 'Airtable' } });
  assert.equal(preferred.data.default, 'airtable');

  airtable.fields.splice(airtable.fields.findIndex((f) => f.name === 'Page key'), 1);
  resetAirtable();
  const missing = await call('/status', null, { env: AT_ENV });
  assert.deepEqual(missing.data.airtable.missingFields, ['Page key']);

  const half = await call('/status', null, { env: { ALLOWED_ORGS: 'northwind', AIRTABLE_BASE_ID: AT_BASE } });
  assert.equal(half.status, 500);
  assert.equal(half.data.setup, true);
  assert.match(half.data.error, /AIRTABLE_TOKEN/);
});

test('airtable full loop: create, comments, changes, resubmit, approve, publish', async () => {
  const none = await reviewOf();
  assert.equal(none.review, null);
  assert.equal(none.poll, 60, 'Airtable is checked less often');

  const created = await call('/review/create', createBody(), { env: AT_ENV });
  assert.equal(created.status, 200, created.data.error);
  const [record] = [...airtable.records.values()];
  assert.equal(created.data.key, displayKey(record.id));
  assert.match(created.data.key, /^RL-[A-Z0-9]{6}$/);
  assert.equal(created.data.url, `https://airtable.com/${AT_BASE}/${AT_TABLE}/${record.id}`);
  const f = record.fields;
  assert.equal(f.Status, 'In review');
  assert.equal(f.Reviewer, 'Arjun Mehta');
  assert.equal(f['Page key'], await pageLabel(PAGE));
  assert.equal(f.Page, 'northwind/website/offers/spring-savings');
  assert.equal(f['Edit in EW'], 'https://da.live/canvas#/northwind/website/offers/spring-savings');
  assert.equal(f.Due, '2026-11-14');
  assert.match(f.Description, /Spring Savings/);
  assert.equal(JSON.parse(f['ReviewLoop data']).requester, 'Priya Shah');
  const { review } = created.data;
  assert.deepEqual([review.tracker, review.trackerName, review.state, review.round], ['airtable', 'Airtable', 'review', 1]);
  assert.deepEqual(review.snapshot, SNAPSHOT);

  assert.equal((await call('/review/create', createBody(), { env: AT_ENV })).status, 409);

  airtable.reviewerComment(record.id, 'Please add “(variable rate)”, @[usrPriya].');
  airtable.move(record.id, 'Changes requested');
  const cached = airtable.calls;
  await reviewOf();
  assert.equal(airtable.calls, cached, 'a second check within seconds is served from the cache');
  resetAirtable();
  const changes = (await reviewOf()).review;
  assert.equal(changes.state, 'changes');
  assert.deepEqual(changes.comments.map((c) => [c.author, c.text, c.own]), [['Arjun Mehta', 'Please add “(variable rate)”, @Priya Shah.', false]]);

  const resent = await call('/review/resubmit', {
    ...PAGE,
    tracker: 'airtable',
    key: created.data.key,
    text: 'Added the variable-rate wording.',
    comment: rereviewComment({
      page, requester: 'Priya Shah', changes: [], round: 2,
    }),
    snapshot: { ...SNAPSHOT, units: [...SNAPSHOT.units, ['text', 'Top of page', 'variable rate', '', '', '']] },
  }, { env: AT_ENV });
  assert.equal(resent.status, 200, resent.data.error);
  assert.equal(record.fields.Status, 'In review');
  assert.equal(resent.data.review.round, 2);
  assert.equal(resent.data.review.snapshot.units.length, 2);
  const mine = resent.data.review.comments.at(-1);
  assert.deepEqual([mine.author, mine.text, mine.own], ['Priya Shah', 'Added the variable-rate wording.', true]);
  assert.doesNotMatch(record.comments.at(-1).text, /[{}]|"type"/, 'Airtable gets plain text, not ADF');

  airtable.move(record.id, 'Approved');
  const approved = (await reviewOf()).review;
  assert.equal(approved.state, 'approved');
  assert.equal(approved.approvedBy, 'Arjun Mehta');
  assert.ok(approved.approvedAt);

  const published = await call('/review/published', {
    ...PAGE, key: created.data.key, comment: publishedComment({ liveUrl: page.liveUrl, publisher: 'Priya Shah' }),
  }, { env: AT_ENV });
  assert.equal(published.status, 200, published.data.error);
  assert.equal(record.fields.Status, 'Done');
  assert.equal(record.fields['Live page'], page.liveUrl);
  const before = airtable.calls;
  const done = (await reviewOf()).review;
  assert.equal(done.state, 'done');
  assert.equal(airtable.calls - before, 1, 'a published review is one call: no comments');

  const next = await call('/review/create', createBody(), { env: AT_ENV });
  assert.notEqual(next.data.key, created.data.key, 'a new record once the last review is done');
});

test('airtable: a record closed to Done by the reviewer counts as approved', async () => {
  const created = await call('/review/create', createBody(), { env: AT_ENV });
  airtable.move(created.data.review.id, 'Done');
  resetAirtable();
  const closed = (await reviewOf()).review;
  assert.deepEqual([closed.state, closed.closedInTracker, closed.approvedBy], ['approved', true, 'Arjun Mehta']);
});

test('airtable: a review key from another page is refused', async () => {
  const other = { ...PAGE, path: '/offers/summer-savings' };
  const created = await call('/review/create', createBody(other), { env: AT_ENV });
  assert.equal(created.status, 200, created.data.error);
  const res = await call('/review/published', {
    ...PAGE, key: created.data.key, comment: publishedComment({ liveUrl: page.liveUrl, publisher: 'Priya Shah' }),
  }, { env: AT_ENV });
  assert.equal(res.status, 403);
  assert.equal(airtable.records.get(created.data.review.id).fields.Status, 'In review');
});

test('both trackers: the type picks one, the hint limits where the worker looks', async () => {
  const jiraOnly = await call('/review/get', { ...PAGE, trackers: ['jira'] }, { env: BOTH });
  assert.equal(jiraOnly.status, 200, jiraOnly.data.error);
  assert.equal(jiraOnly.data.poll, 15);
  assert.equal(airtable.calls, 0, 'a Jira-only site never spends Airtable calls');

  const created = await call('/review/create', createBody({ tracker: 'airtable', trackers: ['jira'] }), { env: BOTH });
  assert.equal(created.status, 200, created.data.error);
  assert.equal(created.data.review.tracker, 'airtable');
  assert.equal(jira.issues.size, 0);

  const found = await call('/review/get', { ...PAGE, trackers: ['', 'airtable'] }, { env: BOTH });
  assert.equal(found.data.review.key, created.data.key);
  assert.equal(found.data.poll, 60);

  const dupe = await call('/review/create', createBody({ tracker: 'jira' }), { env: BOTH });
  assert.equal(dupe.status, 409, 'one open review per page, whatever the tracker');

  const unknown = await call('/review/create', createBody({ tracker: 'trello' }), { env: BOTH });
  assert.equal(unknown.status, 400);
  const absent = await call('/review/create', createBody({ tracker: 'airtable' }), { env: ENV });
  assert.equal(absent.status, 400);
  assert.match(absent.data.error, /not connected to Airtable/);
});

test('airtable: the monthly API limit gets a clear message', async () => {
  airtable.limit = true;
  const res = await call('/review/get', PAGE, { env: AT_ENV });
  assert.equal(res.status, 429);
  assert.match(res.data.error, /1,000 on the free plan/);
});
