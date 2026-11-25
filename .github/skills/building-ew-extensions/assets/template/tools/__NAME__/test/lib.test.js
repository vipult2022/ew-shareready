import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSettings, loadSiteConfig, docPath, SHEET,
} from '../lib/config.js';
import {
  safeUrl, normalizeItem, normalizeItems, filterItems,
} from '../lib/items.js';
import {
  blockTable, itemHtml, itemText, insertBlocker,
} from '../lib/html.js';
import { workerConnection, demoConnection, ConnectionError } from '../lib/connection.js';

const SCRIPT_URL = ['java', 'script:alert(1)'].join('');
const ITEM = {
  id: 'nw-1', title: 'Savings <b>now</b>', summary: 'Fees & more', url: 'https://example.com/a?b=1&c=2',
};
const config = (rows) => ({ ':names': [SHEET], [SHEET]: { data: rows } });

/* lib/config.js */

test('parseSettings uses defaults with no config', () => {
  const s = parseSettings(null);
  assert.equal(s['heading-level'], '3');
  assert.equal(s.block, '');
  assert.equal(s['worker-url'], undefined);
});

test('parseSettings reads the site sheet and lets URL params win', () => {
  const json = config([
    { Key: 'worker-url', Value: 'https://worker.example.com/' },
    { key: 'heading-level', value: '2' },
    { key: 'unknown', value: 'ignored' },
  ]);
  const s = parseSettings(json, '?heading-level=4');
  assert.equal(s['worker-url'], 'https://worker.example.com');
  assert.equal(s['heading-level'], '4');
  assert.equal(s.unknown, undefined);
});

test('parseSettings drops unsafe or invalid values', () => {
  const s = parseSettings(config([
    { key: 'worker-url', value: 'http://evil.example.com' },
    { key: 'heading-level', value: '9' },
    { key: 'block', value: '<img src=x>' },
  ]));
  assert.equal(s['worker-url'], undefined);
  assert.equal(s['heading-level'], '3');
  assert.equal(s.block, '');
  assert.equal(parseSettings(null, '?worker-url=http://localhost:8787/')['worker-url'], 'http://localhost:8787');
});

test('docPath maps folders to index and drops .html', () => {
  assert.equal(docPath('/'), '/index');
  assert.equal(docPath('/offers/'), '/offers/index');
  assert.equal(docPath('/offers/spring.html'), '/offers/spring');
  assert.equal(docPath(undefined), '/index');
});

test('loadSiteConfig falls back to the AEM config API and sends the token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.startsWith('https://admin.da.live')) return new Response('', { status: 404 });
    return Response.json({ ok: true });
  };
  assert.deepEqual(await loadSiteConfig('ims', { org: 'northwind', repo: 'website' }, fetchImpl), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].auth, 'Bearer ims');
  assert.equal(await loadSiteConfig('', { org: 'o', repo: 'r' }, async () => { throw new Error('offline'); }), null);
});

/* lib/items.js */

test('safeUrl only keeps https URLs', () => {
  assert.equal(safeUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeUrl(SCRIPT_URL), '');
  assert.equal(safeUrl('http://example.com'), '');
  assert.equal(safeUrl('https://user:pw@example.com'), '');
  assert.equal(safeUrl('not a url'), '');
});

test('normalizeItem keeps the item shape and drops incomplete items', () => {
  assert.deepEqual(normalizeItem({ id: 7, title: ' T ', url: SCRIPT_URL }), {
    id: '7', title: 'T', summary: '', url: '',
  });
  assert.equal(normalizeItem({ id: '1' }), null);
  assert.equal(normalizeItem(null), null);
  assert.equal(normalizeItems('nope').length, 0);
});

test('filterItems matches title and summary, case-insensitively', () => {
  const items = normalizeItems([ITEM, { id: '2', title: 'Loans', summary: 'Home' }]);
  assert.equal(filterItems(items, '').length, 2);
  assert.deepEqual(filterItems(items, 'HOME').map((i) => i.id), ['2']);
});

/* lib/html.js */

test('itemHtml escapes service text and uses the configured heading level', () => {
  const html = itemHtml(ITEM, { 'heading-level': '2', 'link-text': 'More' });
  assert.match(html, /^<h2>Savings &lt;b&gt;now&lt;\/b&gt;<\/h2>/);
  assert.match(html, /<p>Fees &amp; more<\/p>/);
  assert.match(html, /<a href="https:\/\/example.com\/a\?b=1&amp;c=2">More<\/a>/);
});

test('itemHtml leaves out unsafe links and wraps in a block only when configured', () => {
  assert.doesNotMatch(itemHtml({ ...ITEM, url: SCRIPT_URL }), /<a /);
  const html = itemHtml(ITEM, { block: 'Cards' });
  assert.match(html, /^<table><tbody><tr><td colspan="1"><p>Cards<\/p><\/td><\/tr><tr><td><h3>/);
});

test('blockTable spans the name row across the widest row', () => {
  assert.match(blockTable('Columns', [['a', 'b'], ['c']]), /colspan="2"/);
});

test('itemText joins the plain parts', () => {
  assert.equal(itemText({ title: 'T', summary: '', url: 'https://example.com/' }), 'T\n\nhttps://example.com/');
});

test('insertBlocker refuses demo, read-only and in-block inserts', () => {
  assert.match(insertBlocker({ mode: 'demo' }), /Sample mode/);
  assert.match(insertBlocker({ mode: 'ew', live: { editable: false, blockIndex: null } }), /cannot edit/);
  assert.match(insertBlocker({ mode: 'ew', live: { editable: true, blockIndex: 2 } }), /inside a block/);
  assert.equal(insertBlocker({ mode: 'ew', live: { editable: true, blockIndex: null } }), '');
  assert.equal(insertBlocker({ mode: 'da', live: { editable: true, blockIndex: 0 } }), '');
});

/* lib/connection.js */

test('demoConnection returns normalized sample items', async () => {
  const conn = demoConnection({ items: [ITEM, { title: 'no id' }] });
  assert.equal(conn.mode, 'demo');
  assert.deepEqual((await conn.items()).map((i) => i.id), ['nw-1']);
});

test('workerConnection posts the page with the current token', async () => {
  let token = 'first';
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return Response.json({ items: [ITEM] });
  };
  const page = { org: 'northwind', site: 'website', path: '/index' };
  const conn = workerConnection('https://worker.example.com', () => token, page, fetchImpl);
  await conn.items();
  token = 'refreshed';
  const items = await conn.items();
  assert.equal(items[0].title, ITEM.title);
  assert.equal(calls[0].url, 'https://worker.example.com/items');
  assert.equal(calls[1].auth, 'Bearer refreshed');
  assert.deepEqual(calls[0].body, page);
});

test('workerConnection turns worker errors into ConnectionError with the worker message', async () => {
  const failing = workerConnection('https://w.example.com', () => 't', {}, async () => Response.json({ error: 'Set ALLOWED_ORGS.', code: 'setup' }, { status: 500 }));
  await assert.rejects(failing.items(), (e) => e instanceof ConnectionError && e.code === 'setup' && /ALLOWED_ORGS/.test(e.message));
  const offline = workerConnection('https://w.example.com', () => 't', {}, async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(offline.items(), /Could not reach/);
});
