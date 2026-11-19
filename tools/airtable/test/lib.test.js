import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildContent, imagesIn, markdownToHtml, parseAttachments, suggestFormat, inlineValue,
} from '../lib/format.js';
import { orderFields, defaultFields, searchRecords } from '../lib/fields.js';
import { parseSettings, parseSources } from '../lib/config.js';
import {
  demoConnection, tokenConnection, savedToken, saveToken, TOKEN_PATTERN,
} from '../lib/connection.js';
import {
  listRecords, airtableError, validRef, TABLE_ID,
} from '../lib/airtable.js';
import { slug, cleanFolder } from '../lib/images.js';

const data = JSON.parse(readFileSync(new URL('../demo/northwind.json', import.meta.url)));
const base = data.bases[0].id;
const table = (name) => data.tables[base].find((t) => t.name === name);
const records = (name) => data.records[table(name).id];

test('table: block name row, header row and one row per record', () => {
  const t = table('Savings rates');
  const html = buildContent('table', defaultFields(t, 'table'), records('Savings rates'));
  assert.match(html, /^<table><tbody><tr><td colspan="5"><p>Table<\/p><\/td><\/tr><tr><td><p>Product<\/p>/);
  assert.equal((html.match(/<tr>/g) || []).length, 2 + records('Savings rates').length);
  assert.match(html, /<p>4\.50%<\/p>/);
});

test('table without a header row uses the no header variant', () => {
  const t = table('Savings rates');
  const html = buildContent('table', defaultFields(t, 'table'), records('Savings rates'), { header: false });
  assert.match(html, /<p>Table \(no header\)<\/p>/);
  assert.doesNotMatch(html, /<p>Product<\/p>/);
});

test('cards: photo cell, heading, labelled values and a link', () => {
  const t = table('Accounts');
  const html = buildContent('cards', defaultFields(t, 'cards'), records('Accounts'), {
    imageSrc: () => 'https://content.da.live/o/s/media/airtable/x.jpg',
  });
  assert.match(html, /<td><p><picture><img src="https:\/\/content\.da\.live\/o\/s\/media\/airtable\/x\.jpg" alt="Everyday Checking"><\/picture><\/p><\/td>/);
  assert.match(html, /<h3>Everyday Checking<\/h3>/);
  assert.match(html, /<p><strong>Monthly fee:<\/strong> \$0<\/p>/);
  assert.match(html, /<a href="https:\/\/[^"]+">Learn more<\/a>/);
});

test('imagesIn lists each image once', () => {
  const t = table('Accounts');
  const images = imagesIn('cards', defaultFields(t, 'cards'), records('Accounts'));
  assert.equal(images.length, 4);
  assert.ok(images.every((a) => a.url.startsWith('https://')));
});

test('accordion: question and rich text answer', () => {
  const t = table('FAQs');
  const html = buildContent('accordion', orderFields(t, ['Question', 'Answer']), records('FAQs'));
  assert.match(html, /<p>Accordion<\/p>/);
  assert.match(html, /<td><p>How is APY calculated\?<\/p><\/td><td><p>APY is the yearly rate <strong>including compound interest<\/strong>/);
  assert.match(html, /<ol><li>Tap <strong>Cards<\/strong><\/li>/);
});

test('text: headings and paragraphs, no block', () => {
  const t = table('Branches');
  const html = buildContent('text', defaultFields(t, 'text'), records('Branches'));
  assert.doesNotMatch(html, /<table>/);
  assert.match(html, /^<h3>Harbor Street<\/h3>/);
  assert.match(html, /<a href="tel:\+?5035550142">\(503\) 555-0142<\/a>/);
});

test('values are escaped and unsafe links dropped', () => {
  const fields = [{ name: 'Name', type: 'singleLineText' }, { name: 'Site', type: 'url' }];
  const html = buildContent('text', fields, [{ id: 'r1', fields: { Name: '<img src=x onerror=alert(1)>', Site: ['javascript', 'alert(1)'].join(':') } }]);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markdownToHtml('[x](javascript:alert(1))'), /href/);
  assert.equal(inlineValue('checked', { type: 'checkbox' }), 'Yes');
});

test('markdown: emphasis, links, lists and headings', () => {
  assert.equal(markdownToHtml('**a** _b_ [c](https://x.test)'), '<p><strong>a</strong> <em>b</em> <a href="https://x.test">c</a></p>');
  assert.equal(markdownToHtml('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(markdownToHtml('# Title'), '<h3>Title</h3>');
});

test('attachments: names, https only, images detected', () => {
  const list = parseAttachments('a.jpg (https://x.test/1), plan.pdf (https://x.test/2), bad.png (http://x.test/3)');
  assert.deepEqual(list.map((a) => [a.name, a.image]), [['a.jpg', true], ['plan.pdf', false]]);
});

test('fields: order, defaults and search', () => {
  const t = table('FAQs');
  assert.deepEqual(orderFields(t, ['answer', 'QUESTION', 'nope']).map((f) => f.name), ['Answer', 'Question']);
  assert.deepEqual(defaultFields(t, 'accordion').map((f) => f.name), ['Question', 'Answer']);
  assert.ok(defaultFields(table('Accounts'), 'table').every((f) => f.type !== 'multipleAttachments'));
  assert.equal(searchRecords(records('FAQs'), 'freeze card').length, 1);
  assert.equal(searchRecords(records('FAQs'), '').length, records('FAQs').length);
});

test('suggestFormat picks cards for photos and accordion for FAQs', () => {
  assert.equal(suggestFormat(table('Accounts')), 'cards');
  assert.equal(suggestFormat(table('FAQs')), 'accordion');
  assert.equal(suggestFormat(table('Savings rates')), 'table');
});

test('settings: sheet, URL overrides and safe worker URLs only', () => {
  const json = { airtable: { data: [{ key: 'link-text', value: 'Details' }, { key: 'worker-url', value: 'https://w.test/' }] } };
  const s = parseSettings(json, '?locale=en-gb');
  assert.equal(s['link-text'], 'Details');
  assert.equal(s['worker-url'], 'https://w.test');
  assert.equal(s.locale, 'en-gb');
  assert.equal(parseSettings(null, '?worker-url=http://evil.test')['worker-url'], undefined);
  assert.equal(parseSettings(null, '?worker-url=http://localhost:8787')['worker-url'], 'http://localhost:8787');
});

test('sources: valid rows only, with fields and options', () => {
  const json = {
    'airtable-sources': {
      data: [
        {
          Title: 'FAQs', Base: base, Table: 'FAQs', Fields: 'Question, Answer', Format: 'Accordion', Labels: 'no',
        },
        { Title: 'Broken', Base: 'nope', Table: 'X' },
      ],
    },
  };
  const [faq, ...rest] = parseSources(json);
  assert.equal(rest.length, 0);
  assert.deepEqual(faq.fields, ['Question', 'Answer']);
  assert.equal(faq.format, 'accordion');
  assert.equal(faq.labels, false);
  assert.equal(faq.header, undefined);
});

test('demo connection reads tables by name', async () => {
  const conn = demoConnection(data);
  assert.equal((await conn.bases()).length, 1);
  const tables = await conn.tables(base);
  const { records: rows } = await conn.records(base, 'FAQs');
  assert.ok(tables.length >= 4);
  assert.equal(rows.length, records('FAQs').length);
});

test('token connection: auth header, string cells, paging and cache', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: new URL(url), auth: init.headers.Authorization });
    const u = new URL(url);
    const offset = u.searchParams.get('offset');
    const body = offset
      ? { records: [{ id: 'rec2', fields: { Name: 'B' } }] }
      : { records: [{ id: 'rec1', fields: { Name: 'A' } }], offset: 'next' };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const conn = tokenConnection('pat123', fakeFetch);
  const result = await conn.records('appAAAAAAAAAAAAAA', 'Table 1', { timeZone: 'Asia/Kolkata' });
  assert.deepEqual(result.records.map((r) => r.id), ['rec1', 'rec2']);
  assert.equal(result.more, false);
  assert.equal(calls[0].auth, 'Bearer pat123');
  assert.equal(calls[0].url.pathname, '/v0/appAAAAAAAAAAAAAA/Table%201');
  assert.equal(calls[0].url.searchParams.get('cellFormat'), 'string');
  assert.equal(calls[0].url.searchParams.get('timeZone'), 'Asia/Kolkata');
  await conn.records('appAAAAAAAAAAAAAA', 'Table 1', { timeZone: 'Asia/Kolkata' });
  assert.equal(calls.length, 2);
  conn.clear();
  await conn.records('appAAAAAAAAAAAAAA', 'Table 1', {});
  assert.equal(calls.length, 4);
});

test('listRecords stops at max and reports more', async () => {
  let n = 0;
  const call = async () => {
    n += 1;
    return { records: Array.from({ length: 100 }, (_, i) => ({ id: `r${n}-${i}`, fields: {} })), offset: 'x' };
  };
  const { records: rows, more } = await listRecords(call, 'appAAAAAAAAAAAAAA', 'tblAAAAAAAAAAAAAA', { max: 150 });
  assert.equal(rows.length, 150);
  assert.equal(more, true);
  assert.equal(n, 2);
});

test('errors are plain language', () => {
  assert.match(airtableError(403).message, /add the base under Access/);
  assert.equal(airtableError(429, { errors: [], error: { type: 'PUBLIC_API_BILLING_LIMIT_EXCEEDED' } }).code, 'billing');
  assert.equal(airtableError(429).code, 'rate');
  assert.equal(validRef('tblAAAAAAAAAAAAAA', TABLE_ID), 'tblAAAAAAAAAAAAAA');
  assert.equal(validRef('bad\u0001name', TABLE_ID), '');
});

test('token storage and format', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  saveToken('patX', storage);
  assert.equal(savedToken(storage), 'patX');
  saveToken('', storage);
  assert.equal(savedToken(storage), '');
  assert.ok(TOKEN_PATTERN.test(`patABCDEFGHIJKLMN.${'a'.repeat(64)}`));
  assert.ok(!TOKEN_PATTERN.test('keyABCDEFGHIJKLMN'));
});

test('image names and folders are safe', () => {
  assert.equal(slug('Everyday Checking.JPG'), 'everyday-checking');
  assert.equal(cleanFolder('/media/../airtable/'), '/media/airtable');
  assert.equal(cleanFolder(''), '/media/airtable');
});
