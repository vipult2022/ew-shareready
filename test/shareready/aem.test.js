/* global globalThis */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docPath, webPath, adminUrls, sourceUrls, fetchFirst, getStatus, describeStatus, publishPage,
  withUtm, campaignFor, utmFor, shareLinks, linkedinInspector, facebookDebugger,
  workerStatus, workerShare,
} from '../../tools/shareready/lib/aem.js';

const CONTEXT = { org: 'northwind', repo: 'site', path: '/Offers/Spring-Savings' };

/** responses: url -> body | status number | Error | { status, body, error } */
function fakeFetcher(responses, token = 'ims-token') {
  const calls = [];
  return {
    calls,
    token,
    async auth(url, opts = {}) {
      calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
      let spec = responses[url];
      if (spec instanceof Error) throw spec;
      if (spec === undefined) spec = 404;
      if (typeof spec === 'number') spec = { status: spec };
      if (!('status' in spec) && !('body' in spec)) spec = { status: 200, body: spec };
      const status = spec.status || 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name === 'x-error' ? spec.error || null : null) },
        json: async () => {
          if (spec.body === undefined) throw new SyntaxError('no body');
          return spec.body;
        },
      };
    },
  };
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('maps page paths to document and public paths', () => {
  assert.equal(docPath('/'), '/index');
  assert.equal(docPath(''), '/index');
  assert.equal(docPath('/offers/'), '/offers/index');
  assert.equal(docPath('/offers/spring-savings.html'), '/offers/spring-savings');
  assert.equal(webPath('/index'), '/');
  assert.equal(webPath('/'), '/');
  assert.equal(webPath('/offers/index'), '/offers/');
  assert.equal(webPath('/offers/spring-savings'), '/offers/spring-savings');
  assert.equal(webPath('/reindex'), '/reindex');
});

test('builds classic and AEM API URLs', () => {
  assert.deepEqual(adminUrls('status', CONTEXT), [
    'https://admin.hlx.page/status/northwind/site/main/offers/spring-savings',
    'https://api.aem.live/northwind/sites/site/status/offers/spring-savings',
  ]);
  assert.deepEqual(sourceUrls({ ...CONTEXT, path: '/' }), [
    'https://admin.da.live/source/northwind/site/index.html',
    'https://api.aem.live/northwind/sites/site/source/index.html',
  ]);
  assert.equal(sourceUrls(CONTEXT)[0], 'https://admin.da.live/source/northwind/site/Offers/Spring-Savings.html');
});

test('fetchFirst moves on after a 404 or a network error, and stops on anything else', async () => {
  const fallback = fakeFetcher({ b: { ok: 1 } });
  assert.equal((await fetchFirst(fallback, ['a', 'b'])).status, 200);
  assert.deepEqual(fallback.calls.map((c) => c.url), ['a', 'b']);

  const denied = fakeFetcher({ a: 401, b: { ok: 1 } });
  assert.equal((await fetchFirst(denied, ['a', 'b'])).status, 401);
  assert.equal(denied.calls.length, 1);

  const offline = fakeFetcher({ a: new Error('offline'), b: new Error('offline') });
  const resp = await fetchFirst(offline, ['a', 'b']);
  assert.equal(resp.ok, false);
  assert.equal(resp.status, 0);

  assert.equal((await fetchFirst(fakeFetcher({}), ['a', 'b'])).status, 404);
});

test('describes the publish state of a page', () => {
  const day = (n) => new Date(Date.UTC(2026, 10, n)).toUTCString();
  assert.deepEqual(describeStatus(null), { state: 'unknown', publish: true });
  assert.equal(describeStatus({ ok: true, live: { status: 404 } }).state, 'unpublished');
  assert.equal(describeStatus({ ok: true, live: { status: 200 } }).state, 'unpublished');

  const changed = describeStatus({
    ok: true,
    edit: { lastModified: day(9) },
    preview: { lastModified: day(8) },
    live: { status: 200, lastModified: day(5), url: 'https://main--site--northwind.aem.live/' },
  });
  assert.deepEqual(changed, {
    state: 'changed', publish: true, liveUrl: 'https://main--site--northwind.aem.live/', lastPublished: day(5),
  });

  const live = describeStatus({
    ok: true,
    edit: { lastModified: day(5) },
    preview: { lastModified: day(5) },
    live: { status: 200, lastModified: day(5) },
  });
  assert.equal(live.state, 'live');
  assert.equal(live.publish, false);
});

test('reads the admin status with the content source token', async () => {
  const fetcher = fakeFetcher({
    'https://admin.hlx.page/status/northwind/site/main/offers/spring-savings': {
      live: { status: 404 },
    },
  });
  const status = await getStatus(fetcher, CONTEXT);
  assert.equal(status.ok, true);
  assert.equal(describeStatus(status).state, 'unpublished');
  assert.equal(fetcher.calls[0].headers['x-content-source-authorization'], 'Bearer ims-token');

  const failed = await getStatus(fakeFetcher({}), CONTEXT);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Could not check the page \(404\)/);
});

test('publishes by previewing first, then going live', async () => {
  const fetcher = fakeFetcher({
    'https://admin.hlx.page/preview/northwind/site/main/offers/spring-savings': { preview: { status: 200 } },
    'https://admin.hlx.page/live/northwind/site/main/offers/spring-savings': {
      webPath: '/offers/spring-savings',
      live: { url: 'https://main--site--northwind.aem.live/offers/spring-savings' },
    },
  });
  assert.deepEqual(await publishPage(fetcher, CONTEXT), {
    ok: true,
    url: 'https://main--site--northwind.aem.live/offers/spring-savings',
    webPath: '/offers/spring-savings',
  });
  assert.deepEqual(fetcher.calls.map((c) => [c.method, c.url.split('/')[3]]), [['POST', 'preview'], ['POST', 'live']]);
});

test('publishing falls back to the AEM API for newer sites', async () => {
  const fetcher = fakeFetcher({
    'https://api.aem.live/northwind/sites/site/preview/offers/spring-savings': {},
    'https://api.aem.live/northwind/sites/site/live/offers/spring-savings': { live: { url: 'https://x/' } },
  });
  const result = await publishPage(fetcher, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://x/');
  assert.equal(fetcher.calls.length, 4);
});

test('explains publish failures in plain words', async () => {
  const preview = 'https://admin.hlx.page/preview/northwind/site/main/offers/spring-savings';
  const live = 'https://admin.hlx.page/live/northwind/site/main/offers/spring-savings';

  const denied = await publishPage(fakeFetcher({ [preview]: 403 }), CONTEXT);
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not allowed to preview this page \(403\)/);

  const broken = await publishPage(fakeFetcher({ [preview]: {}, [live]: { status: 500, error: 'boom' } }), CONTEXT);
  assert.equal(broken.error, 'Could not publish the page (500: boom).');

  const offline = await publishPage(fakeFetcher({ [preview]: new Error('offline'), 'https://api.aem.live/northwind/sites/site/preview/offers/spring-savings': new Error('offline') }), CONTEXT);
  assert.equal(offline.error, 'Could not reach AEM to preview the page.');
});

test('adds UTM tags and ignores unsafe values', () => {
  const url = withUtm('https://www.northwind-bank.example/offers/spring?ref=a&utm_source=old', {
    source: 'linkedin', medium: 'social', campaign: 'spring savings', content: '<script>',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('ref'), 'a');
  assert.equal(u.searchParams.get('utm_source'), 'linkedin');
  assert.equal(u.searchParams.get('utm_medium'), 'social');
  assert.equal(u.searchParams.get('utm_campaign'), 'spring savings');
  assert.equal(u.searchParams.get('utm_content'), null);
  assert.equal(withUtm('https://a.example/', {}), 'https://a.example/');
});

test('derives campaign names and per-network UTM tags', () => {
  assert.equal(campaignFor({}, '/offers/spring-savings'), 'spring-savings');
  assert.equal(campaignFor({}, '/offers/index'), 'offers');
  assert.equal(campaignFor({}, '/'), 'home');
  assert.equal(campaignFor({ 'utm-campaign': 'q2-launch' }, '/offers/spring-savings'), 'q2-launch');
  assert.deepEqual(utmFor('slack', { 'utm-source': 'internal', 'utm-medium': 'chat' }, '/a'), {
    source: 'internal', medium: 'chat', campaign: 'a',
  });
  assert.equal(utmFor('linkedin', { 'utm-source': 'internal' }, '/a').source, 'linkedin');
});

test('builds share intents with tagged links', () => {
  const links = shareLinks('https://www.northwind-bank.example/offers/spring-savings', {
    title: 'Spring & savings',
    config: { 'x-handle': '@northwind' },
    path: '/offers/spring-savings',
  });
  assert.deepEqual(links.map((l) => l.id), ['linkedin', 'facebook', 'x', 'whatsapp']);
  const linkedin = new URL(links[0].href);
  const shared = new URL(linkedin.searchParams.get('url'));
  assert.equal(shared.searchParams.get('utm_source'), 'linkedin');
  assert.equal(shared.searchParams.get('utm_campaign'), 'spring-savings');

  const x = new URL(links[2].href);
  assert.equal(x.searchParams.get('text'), 'Spring & savings');
  assert.equal(x.searchParams.get('via'), 'northwind');
  assert.equal(new URL(x.searchParams.get('url')).searchParams.get('utm_source'), 'x');

  const whatsapp = new URL(links[3].href).searchParams.get('text');
  assert.match(whatsapp, /^Spring & savings https:\/\/www\.northwind-bank\.example\/offers\/spring-savings\?utm_source=whatsapp/);

  assert.equal(linkedinInspector('https://a.example/x?y=1'), 'https://www.linkedin.com/post-inspector/inspect/https%3A%2F%2Fa.example%2Fx%3Fy%3D1');
  assert.equal(facebookDebugger('https://a.example/'), 'https://developers.facebook.com/tools/debug/?q=https%3A%2F%2Fa.example%2F');
});

test('rejects worker URLs that are not https', async () => {
  const calls = [];
  await withFetch(async (url) => { calls.push(url); }, async () => {
    assert.equal((await workerStatus('http://worker.example')).ok, false);
    assert.equal((await workerStatus('not a url')).ok, false);
    assert.match((await workerShare('', 't', {})).error, /not a valid https URL/);
  });
  assert.equal(calls.length, 0);
});

test('talks to the worker', async () => {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
  await withFetch(async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/status')) return reply(200, { features: { slack: true } });
    return reply(403, { error: 'Not allowed' });
  }, async () => {
    assert.deepEqual(await workerStatus('https://sr.example.workers.dev/'), { ok: true, features: { slack: true } });
    assert.deepEqual(await workerShare('https://sr.example.workers.dev', 'tok', { steps: ['slack'] }), { ok: false, error: 'Not allowed' });
  });
  assert.equal(calls[0].url, 'https://sr.example.workers.dev/status');
  assert.equal(calls[1].url, 'https://sr.example.workers.dev/share');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[1].opts.body), { steps: ['slack'] });

  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
    assert.match((await workerStatus('https://sr.example.workers.dev')).error, /Could not reach/);
    assert.match((await workerShare('https://sr.example.workers.dev', 't', {})).error, /Could not reach/);
  });
});
