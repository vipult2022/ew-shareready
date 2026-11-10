/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import {
  allowedOrigin, docPath, pagePath, shareUrl, validatePage, readCard, withUtm, resetState,
  slackMessage,
} from '../../worker/src/share.js';

const ENV = {
  ALLOWED_ORGS: 'northwind',
  INDEXNOW_KEY: 'abcdef0123456789abcdef0123456789',
  META_APP_ID: '123',
  META_APP_SECRET: 'shh',
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T/B/X',
  SLACK_CHANNEL: '#campaigns',
};

const LIVE_HTML = `<html><head><title>Fallback</title>
<meta property="og:title" content="Save &amp; grow with Northwind">
<meta property="og:description" content="Rates that &lt;beat&gt; inflation.">
<meta property="og:image" content="https://main--site--northwind.aem.live/media_1.png?width=1200">
<meta property="og:image:alt" content="A family at home">
</head><body></body></html>`;

let calls;
let routes;
const realFetch = globalThis.fetch;

function route(match, respond) {
  routes.push({ match, respond });
}

beforeEach(() => {
  resetState();
  calls = [];
  routes = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = routes.find((r) => (typeof r.match === 'string' ? url.startsWith(r.match) : r.match.test(url)));
    if (!hit) throw new Error(`Unexpected fetch ${url}`);
    return hit.respond(url, init);
  };
  route(/^https:\/\/admin\.da\.live\/source\//, () => new Response('<body></body>'));
  route('https://graph.facebook.com/', () => Response.json({
    title: 'Save & grow', updated_time: '2026-11-10T10:00:00+0000', image: [{ url: 'https://fb/img.png' }],
  }));
  route('https://api.indexnow.org/', () => new Response(null, { status: 202 }));
  route('https://hooks.slack.com/', () => new Response('ok'));
  route(/^https:\/\/main--site--northwind\.aem\.(live|page)\//, () => new Response(LIVE_HTML));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function request(method, path, { body, token = 'tok', origin = 'https://main--site--northwind.preview.da.live' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new Request(`https://shareready.example.workers.dev${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const PAGE = {
  org: 'northwind', site: 'site', path: '/offers/savings', steps: ['facebook', 'indexnow', 'slack'],
};

async function share(body = PAGE, options = {}, env = ENV) {
  const resp = await worker.fetch(request('POST', '/share', { body, ...options }), env);
  return { resp, data: await resp.json() };
}

test('allows da.live, preview proxies and aem hosts, and nothing else by default', () => {
  assert.equal(allowedOrigin('https://da.live'), 'https://da.live');
  assert.equal(allowedOrigin('https://main--site--org.preview.da.live'), 'https://main--site--org.preview.da.live');
  assert.equal(allowedOrigin('https://main--site--org.aem.page'), 'https://main--site--org.aem.page');
  assert.equal(allowedOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(allowedOrigin('https://evil.example'), null);
  assert.equal(allowedOrigin('https://da.live.evil.example'), null);
  assert.equal(allowedOrigin('https://x.da.live', { ALLOWED_ORIGINS: 'https://only.example' }), null);
});

test('answers CORS preflight for allowed origins only', async () => {
  const ok = await worker.fetch(request('OPTIONS', '/share'), ENV);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://main--site--northwind.preview.da.live');
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const denied = await worker.fetch(request('OPTIONS', '/share', { origin: 'https://evil.example' }), ENV);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('reports which steps are set up without exposing secrets', async () => {
  const resp = await worker.fetch(request('GET', '/status'), { ALLOWED_ORGS: 'northwind', INDEXNOW_KEY: 'k' });
  const data = await resp.json();
  assert.deepEqual(data.features, {
    facebook: false, indexnow: true, slack: false, slackChannel: '',
  });
  assert.doesNotMatch(JSON.stringify(data), /shh|hooks\.slack/);
});

test('rejects requests from other origins, without a token, or with bad input', async () => {
  let r = await share(PAGE, { origin: 'https://evil.example' });
  assert.equal(r.resp.status, 403);
  r = await share(PAGE, { token: '' });
  assert.equal(r.resp.status, 401);
  r = await share({ ...PAGE, path: '/../secrets' });
  assert.equal(r.resp.status, 400);
  r = await share({ ...PAGE, org: 'bad org' });
  assert.equal(r.resp.status, 400);
  const notJson = await worker.fetch(new Request('https://w.dev/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: '{nope',
  }), ENV);
  assert.equal(notJson.status, 400);
  const nf = await worker.fetch(request('GET', '/nope'), ENV);
  assert.equal(nf.status, 404);
  assert.equal(calls.length, 0);
});

test('requires ALLOWED_ORGS and refuses other orgs', async () => {
  let r = await share(PAGE, {}, { ...ENV, ALLOWED_ORGS: '' });
  assert.equal(r.resp.status, 500);
  assert.match(r.data.error, /ALLOWED_ORGS/);
  r = await share({ ...PAGE, org: 'contoso' });
  assert.equal(r.resp.status, 403);
  r = await share(PAGE, {}, { ...ENV, ALLOWED_ORGS: 'northwind/other' });
  assert.equal(r.resp.status, 403);
  r = await share(PAGE, {}, { ...ENV, ALLOWED_ORGS: 'northwind/site' });
  assert.equal(r.resp.status, 200);
});

test('checks the token against the DA source API and caches the answer', async () => {
  await share();
  await share();
  const da = calls.filter((c) => c.url.startsWith('https://admin.da.live/'));
  assert.equal(da.length, 1);
  assert.equal(da[0].url, 'https://admin.da.live/source/northwind/site/offers/savings.html');
  assert.equal(da[0].init.headers.Authorization, 'Bearer tok');
});

test('maps DA answers to clear errors and runs no steps', async () => {
  const cases = [[401, 401, /expired/], [403, 403, /access/], [404, 404, /not found/], [500, 502, /500/]];
  for (let i = 0; i < cases.length; i += 1) {
    const [status, expected, message] = cases[i];
    resetState();
    calls = [];
    routes[0] = { match: 'https://admin.da.live/', respond: () => new Response('', { status }) };
    // eslint-disable-next-line no-await-in-loop
    const r = await share();
    assert.equal(r.resp.status, expected);
    assert.match(r.data.error, message);
    assert.equal(calls.length, 1);
  }
});

test('rate limits a token to 30 requests a minute', async () => {
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await share({ ...PAGE, steps: ['indexnow'] });
    assert.equal(r.resp.status, 200);
  }
  const r = await share({ ...PAGE, steps: ['indexnow'] });
  assert.equal(r.resp.status, 429);
});

test('only shares the site own hosts unless ALLOWED_HOSTS lists more', async () => {
  const page = validatePage(PAGE);
  assert.equal(shareUrl(page, undefined, {}), 'https://main--site--northwind.aem.live/offers/savings');
  assert.equal(shareUrl(page, 'https://main--site--northwind.aem.page/x', {}), 'https://main--site--northwind.aem.page/offers/savings');
  assert.equal(shareUrl(page, 'www.northwind.example', { ALLOWED_HOSTS: 'www.northwind.example' }), 'https://www.northwind.example/offers/savings');
  assert.throws(() => shareUrl(page, 'evil.example', {}), /not one of this site's hosts/);
  const r = await share({ ...PAGE, host: 'main--site--contoso.aem.live' });
  assert.equal(r.resp.status, 403);
});

test('maps page paths to DA documents and public URLs', () => {
  assert.equal(docPath('/'), '/index');
  assert.equal(docPath('/offers/'), '/offers/index');
  assert.equal(docPath('/offers/savings.html'), '/offers/savings');
  assert.equal(pagePath('/index'), '/');
  assert.equal(pagePath('/offers/index'), '/offers/');
  assert.equal(pagePath('/offers/savings'), '/offers/savings');
});

test('runs the requested steps and reports each one', async () => {
  const { resp, data } = await share();
  assert.equal(resp.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.url, 'https://main--site--northwind.aem.live/offers/savings');
  assert.deepEqual(Object.keys(data.results).sort(), ['facebook', 'indexnow', 'slack']);
  assert.equal(data.results.facebook.image, 'https://fb/img.png');
  assert.match(data.results.indexnow.message, /accepted/);
  assert.equal(data.results.slack.message, 'Posted to #campaigns.');

  calls = [];
  const only = await share({ ...PAGE, steps: ['indexnow', 'indexnow', 'bogus'] });
  assert.deepEqual(Object.keys(only.data.results), ['indexnow']);
  const empty = await share({ ...PAGE, steps: ['bogus'] });
  assert.equal(empty.resp.status, 400);
});

test('sends the Meta app token in the POST body, not the URL', async () => {
  await share({ ...PAGE, steps: ['facebook'] });
  const fb = calls.find((c) => c.url.startsWith('https://graph.facebook.com/'));
  assert.equal(fb.url, 'https://graph.facebook.com/');
  assert.equal(fb.init.method, 'POST');
  const body = new URLSearchParams(fb.init.body);
  assert.equal(body.get('id'), 'https://main--site--northwind.aem.live/offers/savings');
  assert.equal(body.get('scrape'), 'true');
  assert.equal(body.get('access_token'), '123|shh');
});

test('reports Facebook errors with a debugger link', async () => {
  routes[1] = {
    match: 'https://graph.facebook.com/',
    respond: () => Response.json({ error: { message: 'Invalid OAuth access token' } }, { status: 400 }),
  };
  const { data } = await share({ ...PAGE, steps: ['facebook'] });
  assert.equal(data.ok, false);
  assert.match(data.results.facebook.message, /Invalid OAuth/);
  assert.match(data.results.facebook.debugger, /developers\.facebook\.com\/tools\/debug/);
});

test('sends IndexNow the host, key, key location and URL', async () => {
  await share({ ...PAGE, steps: ['indexnow'] });
  const ping = calls.find((c) => c.url.startsWith('https://api.indexnow.org/'));
  assert.deepEqual(JSON.parse(ping.init.body), {
    host: 'main--site--northwind.aem.live',
    key: ENV.INDEXNOW_KEY,
    keyLocation: `https://main--site--northwind.aem.live/${ENV.INDEXNOW_KEY}.txt`,
    urlList: ['https://main--site--northwind.aem.live/offers/savings'],
  });
  routes[2] = { match: 'https://api.indexnow.org/', respond: () => new Response(null, { status: 403 }) };
  const { data } = await share({ ...PAGE, steps: ['indexnow'] });
  assert.equal(data.results.indexnow.ok, false);
  assert.match(data.results.indexnow.message, /key file/);
});

test('skips steps that are not set up without failing the request', async () => {
  const { resp, data } = await share(PAGE, {}, { ALLOWED_ORGS: 'northwind' });
  assert.equal(resp.status, 200);
  assert.equal(data.ok, true);
  Object.values(data.results).forEach((r) => {
    assert.equal(r.skipped, true);
    assert.match(r.message, /not set up/);
  });
  assert.equal(calls.filter((c) => !c.url.startsWith('https://admin.da.live/')).length, 0);
});

test('posts a Slack card from the live page with UTM tags and an EW edit link', async () => {
  await share({
    ...PAGE,
    steps: ['slack'],
    note: 'Launching <today>\nPlease share',
    utm: { source: 'slack', medium: 'social', campaign: 'autumn-savings' },
  });
  const post = calls.find((c) => c.url.startsWith('https://hooks.slack.com/'));
  const { blocks, text } = JSON.parse(post.init.body);
  const shared = 'https://main--site--northwind.aem.live/offers/savings?utm_source=slack&utm_medium=social&utm_campaign=autumn-savings';
  assert.match(text, /Save & grow with Northwind/);
  assert.equal(blocks[0].text.text, `*<${shared}|Save &amp; grow with Northwind>*\nRates that &lt;beat&gt; inflation.`);
  assert.deepEqual(blocks[1], {
    type: 'image', image_url: 'https://main--site--northwind.aem.live/media_1.png?width=1200', alt_text: 'A family at home',
  });
  assert.equal(blocks[2].text.text, '>Launching &lt;today&gt;\n>Please share');
  assert.equal(blocks[3].elements[0].url, shared);
  assert.equal(blocks[3].elements[1].url, 'https://da.live/canvas#/northwind/site/offers/savings');
  assert.match(blocks[4].elements[0].text, /ShareReady/);
});

test('falls back to the panel card when the live page cannot be read', async () => {
  routes[4] = { match: /^https:\/\/main--site--northwind/, respond: () => new Response('', { status: 404 }) };
  const { data } = await share({
    ...PAGE,
    steps: ['slack'],
    card: { title: 'Draft title', description: 'Draft text', image: 'http://insecure/img.png' },
  });
  assert.equal(data.results.slack.card.title, 'Draft title');
  assert.equal(data.results.slack.card.image, '');
});

test('reports Slack webhook errors', async () => {
  routes[3] = { match: 'https://hooks.slack.com/', respond: () => new Response('invalid_token', { status: 403 }) };
  const { data } = await share({ ...PAGE, steps: ['slack'] });
  assert.equal(data.ok, false);
  assert.equal(data.results.slack.message, 'Slack: invalid_token');
});

test('reads share cards and adds only safe UTM values', () => {
  const card = readCard('<title>T</title><meta name=\'description\' content=\'It&#39;s &#x26; more\'>');
  assert.deepEqual(card, {
    title: 'T', description: "It's & more", image: '', imageAlt: '',
  });
  assert.equal(
    withUtm('https://a.example/p?x=1', { source: 'slack', medium: '<script>', campaign: '' }),
    'https://a.example/p?x=1&utm_source=slack',
  );
  const msg = slackMessage({
    card: { title: '' }, url: 'https://a.example/', editUrl: 'https://da.live/canvas#/o/s/index', host: 'a.example',
  });
  assert.equal(msg.blocks.length, 3);
});
