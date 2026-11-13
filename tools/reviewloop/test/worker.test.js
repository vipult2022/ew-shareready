/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { resetState, allowedOrigin, validatePage } from '../worker/src/http.js';
import {
  resetJira, stateOf, fitProperty, jiraConfig, pageLabel,
} from '../worker/src/jira.js';
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

beforeEach(() => {
  resetState();
  resetJira();
  jira = fakeJira();
  calls = [];
  daStatus = 200;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    calls.push({ url, init });
    if (url.startsWith('https://admin.da.live/source/')) return new Response(null, { status: daStatus });
    if (url.startsWith('https://api.aem.live/')) return new Response(null, { status: 404 });
    if (url.startsWith('https://ims-na1.adobelogin.com/')) return Response.json({ displayName: 'Priya Shah' });
    const plain = url.match(/^https:\/\/main--website--northwind\.aem\.(page|live)\/offers\/spring-savings\.plain\.html\?rl=[a-z0-9]+$/);
    if (plain) {
      return new Response(`<h1>Spring Savings: earn ${plain[1] === 'page' ? '4.50' : '4.25'}% APY</h1>`, {
        headers: { 'Last-Modified': PREVIEWED },
      });
    }
    if (url.includes('.aem.')) return new Response('', { status: 404 });
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
  assert.ok(calls.every((c) => !c.url.includes('.plain.html') || /[?]rl=/.test(c.url)));
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
  assert.equal(closed.closedInJira, true);
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
