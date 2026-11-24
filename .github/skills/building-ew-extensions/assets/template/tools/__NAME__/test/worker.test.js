/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resetCache, toItems } from '../worker/src/index.js';
import { resetState } from '../worker/src/http.js';

const ENV = { ALLOWED_ORGS: 'northwind', SERVICE_URL: 'https://api.example.com', SERVICE_TOKEN: 'team-secret' };
const PAGE = { org: 'northwind', site: 'website', path: '/offers/spring' };
const ORIGIN = 'https://da.live';
const realFetch = globalThis.fetch;
let calls;
let daStatus;
let serviceStatus;

beforeEach(() => {
  resetState();
  resetCache();
  calls = [];
  daStatus = 200;
  serviceStatus = 200;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      host: u.host, path: u.pathname, auth: init.headers?.Authorization, method: init.method || 'GET',
    });
    if (u.host === 'admin.da.live') return new Response(null, { status: daStatus });
    if (u.host === 'api.example.com') {
      return Response.json({ items: [{ id: 1, name: 'Northwind Savings', url: 'https://example.com/s' }] }, { status: serviceStatus });
    }
    return new Response(null, { status: 404 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const post = (route, body = PAGE, { token = 'ims-token', origin = ORIGIN, env = ENV } = {}) => worker.fetch(
  new Request(`https://worker.example.com/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  }),
  env,
);

test('status reports setup without a token', async () => {
  const ok = await (await worker.fetch(new Request('https://w.example.com/status'), ENV)).json();
  assert.equal(ok.configured, true);
  const bare = await (await worker.fetch(new Request('https://w.example.com/status'), {})).json();
  assert.equal(bare.configured, false);
});

test('preflight is allowed only for known origins', async () => {
  const preflight = (origin) => worker.fetch(new Request('https://w.example.com/items', { method: 'OPTIONS', headers: { Origin: origin } }), ENV);
  const good = await preflight('https://main--website--northwind.aem.page');
  assert.equal(good.status, 204);
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), 'https://main--website--northwind.aem.page');
  assert.equal((await preflight('https://evil.example.com')).status, 403);
});

test('items checks the IMS token against DA, then calls the service with the team secret', async () => {
  const resp = await post('items');
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const data = await resp.json();
  assert.deepEqual(data.items, [{
    id: '1', title: 'Northwind Savings', summary: '', url: 'https://example.com/s',
  }]);
  const da = calls.find((c) => c.host === 'admin.da.live');
  assert.equal(da.path, '/source/northwind/website/offers/spring.html');
  assert.equal(da.auth, 'Bearer ims-token');
  assert.equal(calls.find((c) => c.host === 'api.example.com').auth, 'Bearer team-secret');
});

test('items is refused without a token, for other orgs, or without page access', async () => {
  assert.equal((await post('items', PAGE, { token: '' })).status, 401);
  assert.equal((await post('items', { ...PAGE, org: 'other' })).status, 403);
  daStatus = 403;
  assert.equal((await post('items')).status, 403);
  assert.equal(calls.some((c) => c.host === 'api.example.com'), false);
});

test('an empty ALLOWED_ORGS is a setup error, not "allow everyone"', async () => {
  const resp = await post('items', PAGE, { env: { ...ENV, ALLOWED_ORGS: '' } });
  assert.equal(resp.status, 500);
  assert.equal((await resp.json()).code, 'setup');
});

test('bad input, unknown routes and unknown origins are rejected', async () => {
  assert.equal((await post('items', { ...PAGE, path: '/../secret' })).status, 400);
  assert.equal((await post('nope')).status, 404);
  assert.equal((await post('items', PAGE, { origin: 'https://evil.example.com' })).status, 403);
});

test('service errors become clear messages', async () => {
  serviceStatus = 429;
  assert.equal((await post('items')).status, 429);
  resetCache();
  serviceStatus = 401;
  const resp = await post('items');
  assert.equal(resp.status, 502);
  assert.match((await resp.json()).error, /SERVICE_TOKEN/);
});

test('toItems accepts common list shapes and caps the size', () => {
  assert.equal(toItems([{ id: 1, title: 'A' }]).length, 1);
  assert.equal(toItems({ results: [{ id: 1, name: 'B' }] })[0].title, 'B');
  assert.equal(toItems({ items: Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: 'x' })) }).length, 100);
  assert.deepEqual(toItems(null), []);
});
