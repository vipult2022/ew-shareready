/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resetCache, siteLink } from '../worker/src/index.js';
import { resetState } from '../worker/src/http.js';

const ENV = { ALLOWED_ORGS: 'northwind', NOTION_TOKEN: 'ntn_team' };
const PAGE = { org: 'northwind', site: 'website', path: '/offers/spring' };
const DB = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const BRIEF = '33333333-3333-3333-3333-333333333333';
const realFetch = globalThis.fetch;
let calls;
let daStatus;

const notionPage = (id, database) => ({
  id,
  url: `https://www.notion.so/${id.replace(/-/g, '')}`,
  parent: { type: 'database_id', database_id: database },
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Spring' }] },
    'EW page': { type: 'url', url: null },
  },
});

beforeEach(() => {
  resetState();
  resetCache();
  calls = [];
  daStatus = 200;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      host: u.host,
      path: u.pathname,
      auth: init.headers?.Authorization,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (u.host === 'admin.da.live') return new Response(null, { status: daStatus });
    if (u.host === 'images.test') {
      if (u.pathname === '/logo.svg') return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
      if (u.pathname === '/page.html') return new Response('<p>', { headers: { 'Content-Type': 'text/html' } });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.pathname === '/v1/search') {
      const body = JSON.parse(init.body);
      if (body.filter.value === 'database') {
        return Response.json({
          results: [
            { id: DB, title: [{ plain_text: 'Briefs' }], properties: {} },
            { id: OTHER, title: [{ plain_text: 'Other' }], properties: {} },
          ],
        });
      }
      return Response.json({ results: [notionPage(BRIEF, DB), notionPage(OTHER, OTHER)] });
    }
    if (u.pathname === `/v1/databases/${DB}`) return Response.json({ id: DB, title: [{ plain_text: 'Briefs' }], properties: {} });
    if (u.pathname === `/v1/databases/${DB}/query`) return Response.json({ results: [notionPage(BRIEF, DB)] });
    if (u.pathname === `/v1/pages/${BRIEF}`) return Response.json(notionPage(BRIEF, DB));
    if (u.pathname === `/v1/pages/${OTHER}`) return Response.json(notionPage(OTHER, OTHER));
    if (u.pathname.startsWith('/v1/blocks/')) {
      return Response.json({ results: [{ id: 'b', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }] } }] });
    }
    return Response.json({ code: 'object_not_found', message: 'Not found' }, { status: 404 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(route, body = {}, { env = ENV, token = 'ims-token', origin = 'https://da.live' } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://notion.test/${route}`, {
    method: 'POST', headers, body: JSON.stringify({ ...PAGE, ...body }),
  }), env);
}

test('status needs no token', async () => {
  const resp = await worker.fetch(new Request('https://notion.test/status'), ENV);
  assert.deepEqual(await resp.json(), {
    ok: true, service: 'notion', configured: true, limitedDatabases: false, write: true, linkProperty: 'EW page',
  });
});

test('CORS preflight only for allowed origins', async () => {
  const ok = await worker.fetch(new Request('https://notion.test/page', { method: 'OPTIONS', headers: { Origin: 'https://da.live' } }), ENV);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://da.live');
  const bad = await worker.fetch(new Request('https://notion.test/page', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), ENV);
  assert.equal(bad.status, 403);
});

test('checks the IMS token can read the page, then uses the integration secret', async () => {
  const resp = await post('page', { page: BRIEF.replace(/-/g, '') });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.page.title, 'Spring');
  assert.equal(data.blocks[0].rich[0].text, 'Hello');
  const [da, notion] = calls;
  assert.equal(da.host, 'admin.da.live');
  assert.equal(da.method, 'HEAD');
  assert.equal(da.path, '/source/northwind/website/offers/spring.html');
  assert.equal(da.auth, 'Bearer ims-token');
  assert.equal(notion.host, 'api.notion.com');
  assert.equal(notion.auth, 'Bearer ntn_team');
});

test('refuses without a token, for other orgs and when DA says no', async () => {
  assert.equal((await post('databases', {}, { token: '' })).status, 401);
  assert.equal((await worker.fetch(new Request('https://notion.test/databases', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', Origin: 'https://da.live', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...PAGE, org: 'someone-else' }),
  }), ENV)).status, 403);
  daStatus = 403;
  resetState();
  assert.equal((await post('databases')).status, 403);
  assert.equal(calls.filter((c) => c.host === 'api.notion.com').length, 0);
});

test('explains a missing secret', async () => {
  const resp = await post('databases', {}, { env: { ALLOWED_ORGS: 'northwind' } });
  assert.equal(resp.status, 500);
  assert.equal((await resp.json()).code, 'setup');
});

test('lists databases and searches pages', async () => {
  const dbs = await (await post('databases')).json();
  assert.deepEqual(dbs.databases.map((d) => d.title), ['Briefs', 'Other']);
  const found = await (await post('search', { query: 'spring' })).json();
  assert.equal(found.pages.length, 2);
  const search = calls.find((c) => c.path === '/v1/search' && c.body.filter.value === 'page');
  assert.equal(search.body.query, 'spring');
  const db = await (await post('database', { database: `https://www.notion.so/x/Briefs-${DB.replace(/-/g, '')}` })).json();
  assert.equal(db.database.title, 'Briefs');
  assert.equal(db.pages[0].id, BRIEF);
});

test('NOTION_DATABASES limits what the worker reads', async () => {
  const env = { ...ENV, NOTION_DATABASES: DB.replace(/-/g, '') };
  const dbs = await (await post('databases', {}, { env })).json();
  assert.deepEqual(dbs.databases.map((d) => d.id), [DB]);
  const found = await (await post('search', { query: '' }, { env })).json();
  assert.deepEqual(found.pages.map((p) => p.id), [BRIEF]);
  assert.equal((await post('database', { database: OTHER }, { env })).status, 403);
  assert.equal((await post('page', { page: OTHER }, { env })).status, 403);
  assert.equal((await post('page', { page: BRIEF }, { env })).status, 200);
});

test('rejects bad ids and unknown routes', async () => {
  assert.equal((await post('page', { page: 'nope' })).status, 400);
  assert.equal((await post('pages')).status, 404);
  assert.equal((await post('page', { page: '44444444444444444444444444444444' })).status, 404);
});

test('siteLink only allows the author’s own site', () => {
  const page = { org: 'northwind', site: 'website' };
  assert.equal(siteLink('https://da.live/canvas#/northwind/website/offers/spring', page), true);
  assert.equal(siteLink('https://da.live/edit#/northwind/website/offers/spring', page), true);
  assert.equal(siteLink('https://main--website--northwind.aem.page/offers/spring', page), true);
  assert.equal(siteLink('https://da.live/canvas#/other/website/x', page), false);
  assert.equal(siteLink('https://da.live/evil#/northwind/website/x', page), false);
  assert.equal(siteLink('https://main--website--other.aem.page/x', page), false);
  assert.equal(siteLink('http://main--website--northwind.aem.page/x', page), false);
  assert.equal(siteLink('https://user:pw@da.live/canvas#/northwind/website/x', page), false);
  assert.equal(siteLink('https://evil.test/', page), false);
  assert.equal(siteLink('not a url', page), false);
});

test('link writes the new page into the EW page property', async () => {
  const url = 'https://da.live/canvas#/northwind/website/offers/spring';
  const resp = await post('link', { page: BRIEF, url });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: true, property: 'EW page', url });
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { properties: { 'EW page': { url } } });
  assert.equal((await post('link', { page: BRIEF, url: 'https://evil.test/' })).status, 400);
});

test('link can be switched off or renamed', async () => {
  const url = 'https://da.live/canvas#/northwind/website/x';
  assert.equal((await post('link', { page: BRIEF, url }, { env: { ...ENV, ALLOW_WRITE: 'no' } })).status, 403);
  const renamed = await post('link', { page: BRIEF, url }, { env: { ...ENV, LINK_PROPERTY: 'Live page' } });
  assert.equal(renamed.status, 400);
  assert.match((await renamed.json()).error, /“Live page”/);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('file downloads pictures only', async () => {
  const ok = await post('file', { url: 'https://images.test/hero.jpg' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://da.live');
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
  assert.equal((await post('file', { url: 'https://images.test/logo.svg' })).status, 415);
  assert.equal((await post('file', { url: 'https://images.test/page.html' })).status, 415);
  assert.equal((await post('file', { url: 'http://images.test/hero.jpg' })).status, 400);
  assert.equal((await post('file', { url: 'nope' })).status, 400);
  assert.equal((await post('file', { url: 'https://images.test/hero.jpg' }, { token: '' })).status, 401);
});
