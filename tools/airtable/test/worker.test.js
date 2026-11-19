/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resetCache } from '../worker/src/index.js';
import { resetState } from '../worker/src/http.js';

const ENV = { ALLOWED_ORGS: 'northwind', AIRTABLE_TOKEN: 'patTEAM' };
const PAGE = { org: 'northwind', site: 'website', path: '/rates' };
const BASE = 'appAAAAAAAAAAAAAA';
const OTHER = 'appBBBBBBBBBBBBBB';
const realFetch = globalThis.fetch;
let calls;
let daStatus;

beforeEach(() => {
  resetState();
  resetCache();
  calls = [];
  daStatus = 200;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      host: u.host, path: u.pathname, auth: init.headers?.Authorization, method: init.method || 'GET',
    });
    if (u.host === 'admin.da.live') return new Response(null, { status: daStatus });
    if (u.pathname === '/v0/meta/bases') {
      return Response.json({ bases: [{ id: BASE, name: 'Northwind' }, { id: OTHER, name: 'Other' }] });
    }
    if (u.pathname === `/v0/meta/bases/${BASE}/tables`) {
      return Response.json({
        tables: [{
          id: 'tblAAAAAAAAAAAAAA', name: 'FAQs', fields: [], views: [],
        }],
      });
    }
    if (u.pathname === `/v0/${BASE}/FAQs`) {
      return Response.json({ records: [{ id: 'rec1', fields: { Question: 'Q?' } }] });
    }
    return Response.json({ error: { type: 'NOT_FOUND' } }, { status: 404 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(route, body = {}, { env = ENV, token = 'ims-token', origin = 'https://da.live' } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://airtable.test/${route}`, {
    method: 'POST', headers, body: JSON.stringify({ ...PAGE, ...body }),
  }), env);
}

test('status needs no token', async () => {
  const resp = await worker.fetch(new Request('https://airtable.test/status'), ENV);
  assert.deepEqual(await resp.json(), {
    ok: true, service: 'airtable', configured: true, limitedBases: false,
  });
});

test('CORS preflight only for allowed origins', async () => {
  const ok = await worker.fetch(new Request('https://airtable.test/records', { method: 'OPTIONS', headers: { Origin: 'https://da.live' } }), ENV);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://da.live');
  const bad = await worker.fetch(new Request('https://airtable.test/records', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), ENV);
  assert.equal(bad.status, 403);
});

test('checks the IMS token can read the page, then uses the team token', async () => {
  const resp = await post('records', { base: BASE, table: 'FAQs' });
  assert.equal(resp.status, 200);
  assert.deepEqual((await resp.json()).records, [{ id: 'rec1', fields: { Question: 'Q?' } }]);
  const [da, at] = calls;
  assert.equal(da.host, 'admin.da.live');
  assert.equal(da.method, 'HEAD');
  assert.equal(da.path, '/source/northwind/website/rates.html');
  assert.equal(da.auth, 'Bearer ims-token');
  assert.equal(at.host, 'api.airtable.com');
  assert.equal(at.auth, 'Bearer patTEAM');
});

test('refuses without a token, for other orgs and for pages the author cannot read', async () => {
  assert.equal((await post('bases', {}, { token: '' })).status, 401);
  assert.equal((await post('bases', { org: 'contoso' })).status, 403);
  daStatus = 403;
  const resp = await post('bases');
  assert.equal(resp.status, 403);
  assert.match((await resp.json()).error, /do not have access/);
  assert.ok(!calls.some((c) => c.host === 'api.airtable.com'));
});

test('AIRTABLE_BASES limits bases', async () => {
  const env = { ...ENV, AIRTABLE_BASES: BASE };
  const list = await (await post('bases', {}, { env })).json();
  assert.deepEqual(list.bases.map((b) => b.id), [BASE]);
  assert.equal((await post('tables', { base: OTHER }, { env })).status, 403);
  assert.equal((await post('tables', { base: BASE }, { env })).status, 200);
});

test('setup errors and bad input', async () => {
  const resp = await post('bases', {}, { env: { ALLOWED_ORGS: 'northwind' } });
  assert.equal(resp.status, 500);
  assert.match((await resp.json()).error, /AIRTABLE_TOKEN/);
  assert.equal((await post('tables', { base: 'nope' })).status, 400);
  assert.equal((await post('records', { base: BASE })).status, 400);
  assert.equal((await post('records', { path: '/../x' })).status, 400);
  assert.equal((await post('nothing')).status, 404);
});

test('Airtable errors pass through in plain language', async () => {
  const resp = await post('records', { base: BASE, table: 'Missing' });
  assert.equal(resp.status, 404);
  assert.match((await resp.json()).error, /could not find/);
});
