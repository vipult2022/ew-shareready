/* global globalThis */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanId, richText, propertyValue, simplifyPage, normalizeBlock, blockTree, tokenCall,
  setUrlProperty, NotionError,
} from '../lib/notion.js';
import {
  convertPage, documentHtml, suggestPath, cleanPath, inline, imagesIn, imageName,
} from '../lib/convert.js';
import { parseSettings, parseSources, databaseId } from '../lib/config.js';
import { copyImages, slug } from '../lib/images.js';
import { demoConnection, workerConnection } from '../lib/connection.js';

const ID = '41d50256e3308108b228fd9122329a60';
const DASHED = '41d50256-e330-8108-b228-fd9122329a60';
const t = (text, extra = {}) => ({ text, ...extra });
const SCRIPT_URL = ['java', 'script:alert(1)'].join('');

/* lib/notion.js */

test('cleanId accepts ids and Notion links', () => {
  assert.equal(cleanId(ID), DASHED);
  assert.equal(cleanId(DASHED.toUpperCase()), DASHED);
  assert.equal(cleanId(`https://www.notion.so/team/Spring-Savings-${ID}?pvs=4`), DASHED);
  assert.equal(cleanId('nope'), '');
  assert.equal(cleanId(''), '');
});

test('richText keeps styles and safe links, drops mentions', () => {
  const out = richText([
    { plain_text: 'Bold', annotations: { bold: true } },
    { plain_text: 'link', href: 'https://northwind.example/', annotations: {} },
    { plain_text: 'bad', href: SCRIPT_URL, annotations: {} },
    {
      type: 'mention', plain_text: '@Page', href: 'https://www.notion.so/x', annotations: {},
    },
    { plain_text: '', annotations: {} },
  ]);
  assert.deepEqual(out, [
    t('Bold', { bold: true }), t('link', { href: 'https://northwind.example/' }), t('bad'), t('@Page'),
  ]);
});

test('propertyValue reads the common property types', () => {
  assert.equal(propertyValue({ type: 'select', select: { name: 'Ready' } }), 'Ready');
  assert.equal(propertyValue({ type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] }), 'a, b');
  assert.equal(propertyValue({ type: 'date', date: { start: '2027-01-01', end: null } }), '2027-01-01');
  assert.equal(propertyValue({ type: 'checkbox', checkbox: true }), 'Yes');
  assert.equal(propertyValue({ type: 'number', number: 0 }), '0');
  assert.equal(propertyValue({ type: 'url', url: null }), '');
  assert.equal(propertyValue({ type: 'rich_text', rich_text: [{ plain_text: 'Hi' }] }), 'Hi');
  assert.equal(propertyValue({ type: 'unique_id', unique_id: { prefix: 'NW', number: 7 } }), 'NW-7');
  assert.equal(propertyValue({ type: 'rollup', rollup: {} }), '');
});

test('simplifyPage keeps title, icon, database and colours', () => {
  const page = simplifyPage({
    id: DASHED,
    url: 'https://www.notion.so/x',
    icon: { type: 'emoji', emoji: '🌱' },
    last_edited_time: '2026-11-19T10:00:00.000Z',
    parent: { type: 'database_id', database_id: 'db' },
    properties: {
      Name: { type: 'title', title: [{ plain_text: ' Spring ' }] },
      Status: { type: 'select', select: { name: 'Drafting', color: 'yellow' } },
    },
  });
  assert.equal(page.title, 'Spring');
  assert.equal(page.icon, '🌱');
  assert.equal(page.database, 'db');
  assert.deepEqual(page.properties, [{
    name: 'Status', type: 'select', value: 'Drafting', color: 'yellow',
  }]);
});

test('normalizeBlock maps Notion blocks and drops the rest', () => {
  assert.deepEqual(normalizeBlock({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'H' }], is_toggleable: true } }), { type: 'heading_2', rich: [t('H')], toggle: true });
  assert.deepEqual(normalizeBlock({ type: 'image', image: { type: 'file', file: { url: 'https://s3/x.png' }, caption: [] } }), {
    type: 'image', url: 'https://s3/x.png', expires: true, caption: [],
  });
  assert.equal(normalizeBlock({ type: 'equation', equation: { expression: 'a+b' } }).text, 'a+b');
  assert.equal(normalizeBlock({ type: 'breadcrumb', breadcrumb: {} }), null);
  assert.equal(normalizeBlock(null), null);
});

function fakeCall(pages) {
  const seen = [];
  const call = async (path) => {
    seen.push(path);
    const [, id] = path.match(/^\/blocks\/([^/]+)\/children/);
    const cursor = new URLSearchParams(path.split('?')[1]).get('start_cursor');
    return pages[`${id}${cursor ? `@${cursor}` : ''}`] || { results: [] };
  };
  call.seen = seen;
  return call;
}

const para = (id, text, more = {}) => ({
  id, type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] }, has_children: false, ...more,
});

test('blockTree follows pages of results and children', async () => {
  const call = fakeCall({
    root: { results: [para('a', 'one'), { ...para('b', 'two'), has_children: true }], has_more: true, next_cursor: 'c2' },
    'root@c2': { results: [para('c', 'three')] },
    b: { results: [para('b1', 'child')] },
  });
  const { blocks, truncated } = await blockTree(call, 'root');
  assert.equal(truncated, false);
  assert.deepEqual(blocks.map((b) => b.rich[0].text), ['one', 'two', 'three']);
  assert.equal(blocks[1].children[0].rich[0].text, 'child');
});

test('blockTree stops at the limits and says so', async () => {
  const call = fakeCall({
    root: { results: [para('a', '1'), para('b', '2'), para('c', '3')] },
  });
  const { blocks, truncated } = await blockTree(call, 'root', { maxBlocks: 2 });
  assert.equal(blocks.length, 2);
  assert.equal(truncated, true);
  const deep = fakeCall({ root: { results: [{ ...para('a', '1'), has_children: true }] } });
  const result = await blockTree(deep, 'root', { maxDepth: 1 });
  assert.equal(result.truncated, true);
  assert.deepEqual(deep.seen, ['/blocks/root/children?page_size=100']);
});

test('blockTree shows a synced block original and skips one it cannot read', async () => {
  const call = async (path) => {
    if (path.startsWith('/blocks/orig/')) return { results: [para('x', 'shared')] };
    if (path.startsWith('/blocks/gone/')) throw new NotionError(404, 'gone');
    return {
      results: [
        {
          id: 's1', type: 'synced_block', synced_block: { synced_from: { block_id: 'orig' } }, has_children: true,
        },
        {
          id: 's2', type: 'synced_block', synced_block: { synced_from: { block_id: 'gone' } }, has_children: true,
        },
      ],
    };
  };
  const { blocks } = await blockTree(call, 'root');
  assert.equal(blocks[0].children[0].rich[0].text, 'shared');
  assert.deepEqual(blocks[1].children, []);
});

test('tokenCall sends the secret, retries when busy and hides a bad secret', async () => {
  const sent = [];
  const answers = [new Response('{}', { status: 502 }), Response.json({ ok: 1 })];
  const call = tokenCall('ntn_secret', async (url, init) => {
    sent.push({ url, init });
    return answers.shift();
  });
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => original(fn, 0);
  try {
    assert.deepEqual(await call('/search', { method: 'POST', body: { a: 1 } }), { ok: 1 });
  } finally {
    globalThis.setTimeout = original;
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'https://api.notion.com/v1/search');
  assert.equal(sent[0].init.headers.Authorization, 'Bearer ntn_secret');
  assert.equal(sent[0].init.headers['Notion-Version'], '2022-06-28');
  const bad = tokenCall('x', async () => Response.json({ code: 'unauthorized', message: 'no' }, { status: 401 }));
  await assert.rejects(bad('/search'), (e) => e instanceof NotionError && e.status === 502);
});

test('setUrlProperty only writes an existing URL property', async () => {
  const writes = [];
  const call = async (path, init = {}) => {
    if (init.method === 'PATCH') {
      writes.push(init.body);
      return {};
    }
    return { properties: { 'EW page': { type: 'url' }, Owner: { type: 'rich_text' } } };
  };
  assert.deepEqual(await setUrlProperty(call, 'p', 'EW page', 'https://da.live/canvas#/o/s/x'), {
    ok: true, property: 'EW page', url: 'https://da.live/canvas#/o/s/x',
  });
  assert.deepEqual(writes, [{ properties: { 'EW page': { url: 'https://da.live/canvas#/o/s/x' } } }]);
  await assert.rejects(setUrlProperty(call, 'p', 'Owner', 'https://x'), /must be a URL property/);
  await assert.rejects(setUrlProperty(call, 'p', 'Missing', 'https://x'), /no “Missing” property/);
});

/* lib/convert.js */

const PAGE = {
  title: 'Spring <Savings>',
  properties: [
    { name: 'Description', value: 'Earn more' },
    { name: 'Keywords', value: 'savings' },
    { name: 'Page path', value: '/Offers/Spring Savings 2027' },
  ],
};
const rich = (text, extra) => [t(text, extra)];

test('inline escapes text and drops unsafe links', () => {
  assert.equal(inline([t('<b>', { bold: true, href: 'https://x.test/?a=1&b=2' })]), '<a href="https://x.test/?a=1&amp;b=2"><strong>&lt;b&gt;</strong></a>');
  assert.equal(inline([t('x', { href: SCRIPT_URL })]), 'x');
  assert.equal(inline([t('a\nb', { code: true })]), '<code>a<br>b</code>');
});

test('convertPage builds headings, lists, sections and metadata', () => {
  const blocks = [
    { type: 'heading_1', rich: rich('Why') },
    { type: 'bulleted_list_item', rich: rich('one'), children: [{ type: 'bulleted_list_item', rich: rich('nested') }] },
    { type: 'bulleted_list_item', rich: rich('two') },
    { type: 'to_do', rich: rich('done'), checked: true },
    { type: 'divider' },
    { type: 'callout', icon: '⚠️', rich: rich('Careful') },
    { type: 'child_page', title: 'Notes' },
  ];
  const out = convertPage({ page: PAGE, blocks, truncated: true });
  assert.equal(out.sections.length, 2);
  assert.equal(out.sections[0], '<h1>Spring &lt;Savings&gt;</h1><h2>Why</h2><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ul><li>☑ done</li></ul>');
  assert.match(out.sections[1], /^<blockquote><p>⚠️ Careful<\/p><\/blockquote><table>/);
  assert.match(out.sections[1], /<td colspan="2"><p>Metadata<\/p><\/td>/);
  assert.match(out.sections[1], /<td><p>Description<\/p><\/td><td><p>Earn more<\/p><\/td>/);
  assert.equal(out.html, out.sections.join('<hr>'));
  assert.deepEqual(out.skipped, ['Sub-page “Notes”', 'The end of a very long page']);
});

test('options turn off the title, metadata and sections', () => {
  const blocks = [
    { type: 'heading_1', rich: rich('Why') }, { type: 'divider' }, { type: 'paragraph', rich: rich('x') },
  ];
  const off = { title: false, metadata: false, sections: false };
  const out = convertPage({ page: PAGE, blocks }, off);
  assert.deepEqual(out.sections, ['<h1>Why</h1><p>x</p>']);
});

test('tables, toggles and columns become blocks', () => {
  const row = (...cells) => ({ type: 'table_row', cells: cells.map((c) => rich(c)) });
  const blocks = [
    { type: 'table', header: true, children: [row('Term', 'APY'), row('12 months', '4.50%')] },
    { type: 'table', header: false, children: [row('a', 'b')] },
    { type: 'toggle', rich: rich('Who?'), children: [{ type: 'paragraph', rich: rich('Anyone') }] },
    {
      type: 'heading_3', toggle: true, rich: rich('When?'), children: [{ type: 'bulleted_list_item', rich: rich('Now') }],
    },
    {
      type: 'column_list',
      children: [
        { type: 'column', children: [{ type: 'paragraph', rich: rich('Left') }] },
        { type: 'column', children: [{ type: 'heading_2', rich: rich('Right') }] },
      ],
    },
  ];
  const { html } = convertPage({ page: {}, blocks }, { title: false, metadata: false });
  assert.equal(html, [
    '<table><tbody><tr><td colspan="2"><p>Table</p></td></tr><tr><td><p>Term</p></td><td><p>APY</p></td></tr><tr><td><p>12 months</p></td><td><p>4.50%</p></td></tr></tbody></table>',
    '<table><tbody><tr><td colspan="2"><p>Table (no header)</p></td></tr><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
    '<table><tbody><tr><td colspan="2"><p>Accordion</p></td></tr><tr><td><p>Who?</p></td><td><p>Anyone</p></td></tr><tr><td><p>When?</p></td><td><ul><li>Now</li></ul></td></tr></tbody></table>',
    '<table><tbody><tr><td colspan="2"><p>Columns</p></td></tr><tr><td><p>Left</p></td><td><h2>Right</h2></td></tr></tbody></table>',
  ].join(''));
});

test('images are listed once and use the copied address', () => {
  const blocks = [
    {
      type: 'image', url: 'https://s3.test/a/hero.png?sig=1', expires: true, caption: rich('Spring hero'),
    },
    { type: 'paragraph', rich: rich('x'), children: [{ type: 'image', url: 'https://s3.test/a/hero.png?sig=1', caption: [] }] },
    { type: 'image', url: SCRIPT_URL, caption: [] },
  ];
  assert.deepEqual(imagesIn(blocks), [{ url: 'https://s3.test/a/hero.png?sig=1', name: 'Spring hero', expires: true }]);
  const { html } = convertPage({ page: {}, blocks }, {
    title: false, metadata: false, imageSrc: () => 'https://content.da.live/o/s/media/notion/hero.png',
  });
  assert.equal(html, '<p><picture><img src="https://content.da.live/o/s/media/notion/hero.png" alt="Spring hero"></picture></p><p>x</p><p><picture><img src="https://content.da.live/o/s/media/notion/hero.png" alt=""></picture></p>');
  assert.equal(imageName('https://s3.test/x/photo%20one.jpg'), 'photo one.jpg');
  assert.equal(imageName('https://site.test/media_abc.jpg?w=1'), 'notion-image');
});

test('documentHtml wraps sections the way DA stores them', () => {
  assert.equal(documentHtml(['<p>a</p>', '<p>b</p>']), '<body><header></header><main><div><p>a</p></div><div><p>b</p></div></main><footer></footer></body>');
  assert.equal(documentHtml([]), '<body><header></header><main><div></div></main><footer></footer></body>');
});

test('paths come from the Page path property or the title', () => {
  assert.equal(cleanPath(' /Offers/Spring Savings 2027.html '), '/offers/spring-savings-2027');
  assert.equal(cleanPath('https://x.test/a//b/'), '/a/b');
  assert.equal(cleanPath('../..'), '');
  assert.equal(suggestPath(PAGE), '/offers/spring-savings-2027');
  assert.equal(suggestPath({ title: 'How to: freeze / unfreeze', properties: [] }), '/drafts/how-to-freeze-unfreeze');
  assert.equal(suggestPath({ title: '', properties: [] }, { folder: '' }), '/untitled');
});

/* lib/config.js */

test('settings come from the notion sheet and the URL', () => {
  const json = {
    notion: {
      data: [
        { key: 'worker-url', value: 'https://notion.example.workers.dev/' },
        { key: 'new-page-folder', value: 'Briefs/2027' },
        { key: 'unknown', value: 'x' },
      ],
    },
  };
  const settings = parseSettings(json, '?image-folder=/media/briefs');
  assert.equal(settings['worker-url'], 'https://notion.example.workers.dev');
  assert.equal(settings['new-page-folder'], '/briefs/2027');
  assert.equal(settings['image-folder'], '/media/briefs');
  assert.equal(settings.unknown, undefined);
  assert.equal(parseSettings({ notion: [{ key: 'worker-url', value: 'http://evil.test' }] })['worker-url'], undefined);
  assert.equal(parseSettings(null, '?worker-url=http://localhost:8787')['worker-url'], 'http://localhost:8787');
});

test('sources need a title and a database id or link', () => {
  const sources = parseSources({
    'notion-sources': {
      data: [
        { Title: 'Briefs', Database: `https://www.notion.so/team/${ID}?v=0123456789abcdef0123456789abcdef`, Status: 'Ready, Drafting' },
        { title: 'Broken', database: 'nope' },
        { title: '', database: ID },
      ],
    },
  });
  assert.deepEqual(sources, [{ title: 'Briefs', database: ID, status: ['Ready', 'Drafting'] }]);
  assert.equal(databaseId(DASHED), ID);
});

/* lib/images.js */

test('copyImages copies through the worker when the browser cannot download', async () => {
  const puts = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'PUT') {
      puts.push({ url, auth: init.headers.Authorization });
      return new Response('{}', { status: 201 });
    }
    if (url.includes('s3')) return new Response(new Blob(['png'], { type: 'image/png' }));
    throw new TypeError('Failed to fetch');
  };
  const viaWorker = [];
  const { copied, failed } = await copyImages([
    { url: 'https://s3.test/a.png', name: 'Hero photo' },
    { url: 'https://site.test/b.jpg', name: 'notion-image' },
  ], {
    org: 'o',
    repo: 's',
    token: 'ims',
    fetchImpl,
    fallback: async (url) => {
      viaWorker.push(url);
      return new Blob(['jpg'], { type: 'image/jpeg' });
    },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(viaWorker, ['https://site.test/b.jpg']);
  assert.match(copied.get('https://s3.test/a.png'), /^https:\/\/content\.da\.live\/o\/s\/media\/notion\/hero-photo-[0-9a-f]+\.png$/);
  assert.match(copied.get('https://site.test/b.jpg'), /\/media\/notion\/notion-image-[0-9a-f]+\.jpg$/);
  assert.equal(puts[0].auth, 'Bearer ims');
  assert.equal(slug('Spring Hero.PNG'), 'spring-hero');
});

/* lib/connection.js */

test('demo connection serves the sample data and never writes', async () => {
  const page = {
    id: 'p1', title: 'Spring', database: DASHED, properties: [],
  };
  const conn = demoConnection({
    databases: [{ id: DASHED, title: 'Briefs' }],
    pages: { p1: { page, blocks: [], truncated: false } },
  });
  assert.equal((await conn.database(ID)).pages[0].id, 'p1');
  assert.equal((await conn.search('spr')).pages.length, 1);
  assert.equal((await conn.search('zzz')).pages.length, 0);
  assert.equal((await conn.page('p1')).page.title, 'Spring');
  await assert.rejects(conn.page('nope'), /could not find/);
  await assert.rejects(conn.link('p1', 'https://x'), /does not write/);
});

test('worker connection sends the page and the IMS token', async () => {
  const sent = [];
  const conn = workerConnection('https://w.test', () => 'ims', { org: 'o', site: 's', path: '/x' }, async (url, init) => {
    sent.push({ url, init });
    if (url.endsWith('/page')) return Response.json({ error: 'Nope', code: 'object_not_found' }, { status: 404 });
    return Response.json({ databases: [{ id: 'd' }] });
  });
  assert.deepEqual(await conn.databases(), [{ id: 'd' }]);
  await conn.databases();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers.Authorization, 'Bearer ims');
  assert.deepEqual(JSON.parse(sent[0].init.body), { org: 'o', site: 's', path: '/x' });
  await assert.rejects(conn.page('p'), (e) => e.status === 404 && e.message === 'Nope' && e.code === 'object_not_found');
});
