/* global globalThis */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfig, configFromQuery, bulkFor, toAdminUrl, siteOrigins, loadConfig, fetchSource,
  findSiteIndex,
} from '../../tools/shareready/lib/sources.js';
import { platformIssues } from '../../tools/shareready/lib/checks.js';

test('reads the shareready sheet from a multi-sheet site config', () => {
  const json = {
    ':names': ['library', 'shareready'],
    library: { data: [{ title: 'ShareReady', path: '/tools/shareready.html' }] },
    shareready: {
      data: [
        { Key: 'Host', Value: 'www.northwind-bank.example ' },
        { key: 'worker-url', value: 'https://shareready.example.workers.dev' },
        { key: 'brand', value: '' },
        { key: '', value: 'ignored' },
      ],
    },
  };
  assert.deepEqual(parseConfig(json), {
    host: 'www.northwind-bank.example',
    'worker-url': 'https://shareready.example.workers.dev',
  });
  assert.deepEqual(parseConfig({ ':sheetname': 'shareready', data: [{ key: 'brand', value: 'Northwind' }] }), { brand: 'Northwind' });
  assert.deepEqual(parseConfig({ data: [{ key: 'brand', value: 'Wrong sheet' }] }), {});
  assert.deepEqual(parseConfig(null), {});
});

test('takes known config keys from the plugin URL only', () => {
  assert.deepEqual(configFromQuery('?host=www.example.com&token=nope&brand='), { host: 'www.example.com' });
});

test('bulk metadata matches globs and later rows win', () => {
  const json = {
    data: [
      { URL: '/**', Template: 'default', 'og:site_name': 'Northwind Bank' },
      { URL: '/offers/*', Template: 'offer', Image: '' },
      { URL: '/accounts/**', Template: 'account' },
    ],
  };
  assert.deepEqual(bulkFor('/offers/spring-savings', json), { template: 'offer', 'og:site_name': 'Northwind Bank' });
  assert.deepEqual(bulkFor('/offers/2026/spring', json), { template: 'default', 'og:site_name': 'Northwind Bank' });
  assert.deepEqual(bulkFor('/accounts/a/b', json).template, 'account');
  assert.deepEqual(bulkFor('/x', null), {});
});

test('maps content.da.live media to the source API and builds site origins', () => {
  assert.equal(
    toAdminUrl('https://content.da.live/northwind/site/media/a.jpg'),
    'https://admin.da.live/source/northwind/site/media/a.jpg',
  );
  assert.equal(toAdminUrl('https://main--site--northwind.aem.page/media_1.jpg'), null);
  assert.equal(toAdminUrl('not a url'), null);
  assert.deepEqual(siteOrigins({ org: 'northwind', repo: 'site', branch: 'Feature/Share' }), {
    preview: 'https://feature-share--site--northwind.aem.page',
    live: 'https://main--site--northwind.aem.live',
  });
});

function fakeFetcher(responses) {
  const calls = [];
  return {
    calls,
    token: 't',
    async auth(url) {
      calls.push(url);
      const body = responses[url];
      if (body instanceof Error) throw body;
      if (body === undefined) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => body,
      };
    },
  };
}

test('loads config and source through the DA admin API', async () => {
  const fetcher = fakeFetcher({
    'https://admin.da.live/config/northwind/site/': { shareready: { data: [{ key: 'brand', value: 'Northwind Bank' }] } },
    'https://admin.da.live/source/northwind/site/index.html': '<body></body>',
  });
  assert.deepEqual(await loadConfig(fetcher, { org: 'northwind', repo: 'site' }), { brand: 'Northwind Bank' });
  assert.equal(await fetchSource(fetcher, { org: 'northwind', repo: 'site', path: '/' }), '<body></body>');
  await assert.rejects(
    fetchSource(fetcher, { org: 'northwind', repo: 'site', path: '/missing' }),
    (error) => error.status === 404,
  );
  const offline = fakeFetcher({ 'https://admin.da.live/config/northwind/site/': new Error('offline') });
  assert.deepEqual(await loadConfig(offline, { org: 'northwind', repo: 'site' }), {});
});

test('falls back to the AEM API for config and source on newer sites', async () => {
  const fetcher = fakeFetcher({
    'https://api.aem.live/northwind/sites/site/config/editor/da.json': { shareready: [{ key: 'brand', value: 'Northwind Bank' }] },
    'https://api.aem.live/northwind/sites/site/source/offers/spring.html': '<body>new</body>',
  });
  assert.deepEqual(await loadConfig(fetcher, { org: 'northwind', repo: 'site' }), { brand: 'Northwind Bank' });
  assert.equal(await fetchSource(fetcher, { org: 'northwind', repo: 'site', path: '/offers/spring' }), '<body>new</body>');
  assert.deepEqual(fetcher.calls, [
    'https://admin.da.live/config/northwind/site/',
    'https://api.aem.live/northwind/sites/site/config/editor/da.json',
    'https://admin.da.live/source/northwind/site/offers/spring.html',
    'https://api.aem.live/northwind/sites/site/source/offers/spring.html',
  ]);
});

test('finds the query index on the plugin origin, then on the live site', async () => {
  const context = { org: 'northwind', repo: 'site' };
  const original = globalThis.fetch;
  const calls = [];
  const serve = (found) => async (url) => {
    calls.push(url);
    return found.includes(url)
      ? { ok: true, status: 200, json: async () => ({ data: [{ path: '/' }] }) }
      : { ok: false, status: 404 };
  };
  try {
    globalThis.fetch = serve(['https://main--site--northwind.aem.live/query-index.json']);
    const fromSite = await findSiteIndex(context, {}, new URL('https://main--site--northwind.aem.page/tools/shareready.html'));
    assert.deepEqual(fromSite, { index: { data: [{ path: '/' }] }, error: null });
    assert.deepEqual(calls.splice(0), [
      'https://main--site--northwind.aem.page/query-index.json',
      'https://main--site--northwind.aem.live/query-index.json',
    ]);

    globalThis.fetch = serve([]);
    const missing = await findSiteIndex(context, { 'query-index': '/en/query-index.json' }, new URL('https://tools.example/'));
    assert.deepEqual(missing, {
      index: null,
      error: { url: 'https://main--site--northwind.aem.live/en/query-index.json', error: 'HTTP 404' },
    });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('platform issues follow the field each platform shows', () => {
  const checks = [
    {
      id: 'title-long', severity: 'warning', field: 'title', platforms: ['google', 'linkedin'],
    },
    { id: 'description-missing', severity: 'warning', field: 'description' },
    { id: 'alt-missing', severity: 'info', field: 'image-alt' },
    { id: 'title-ok', severity: 'pass', field: 'title' },
  ];
  assert.deepEqual(platformIssues(checks, 'google').map((c) => c.id), ['title-long', 'description-missing']);
  assert.deepEqual(platformIssues(checks, 'linkedin').map((c) => c.id), ['title-long']);
  assert.deepEqual(platformIssues(checks, 'slack').map((c) => c.id), ['description-missing']);
});
