import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import {
  extractPage, parseHtml, withSavedMetadata, metadataSignature,
} from '../../tools/shareready/lib/extract.js';
import { runChecks } from '../../tools/shareready/lib/checks.js';
import {
  buildProposal, mergeRows, toTableHtml, applyToDocument, selectionInMetadata, suggestTitle,
} from '../../tools/shareready/lib/metadata-block.js';
import { truncateToWidth, wrapLines, setMeasurer } from '../../tools/shareready/lib/measure.js';
import { imageLayout, getPlatform } from '../../tools/shareready/lib/platforms.js';

const DEMO = new URL('../../tools/shareready/demo/', import.meta.url);
const BASE = 'http://localhost:3000';
const MEDIA = `${BASE}/tools/shareready/demo/media`;
const IMAGES = new Map([
  [`${MEDIA}/spring-square.jpg`, { ok: true, width: 800, height: 800 }],
  [`${MEDIA}/spring-banner.jpg`, { ok: true, width: 1200, height: 630 }],
  [`${MEDIA}/checking-card.jpg`, { ok: true, width: 1200, height: 630 }],
]);
const OPTS = { host: 'www.northwind-bank.example', assetBase: BASE };

async function load(name, path) {
  const html = await readFile(new URL(`${name}.html`, DEMO), 'utf8');
  const doc = parseHtml(html, DOMParser);
  return { doc, page: extractPage(doc, { ...OPTS, path }) };
}

async function index() {
  return JSON.parse(await readFile(new URL('query-index.json', DEMO), 'utf8'));
}

function ids(result) {
  return result.checks.map((c) => c.id);
}

test('extracts EDS defaults from a draft without metadata', async () => {
  const { page } = await load('spring-savings', '/offers/spring-savings');
  assert.equal(page.hasMetadataBlock, false);
  assert.equal(page.title.source, 'h1');
  assert.match(page.title.value, /^Spring Savings Event: Earn 4\.50% APY/);
  assert.equal(page.description.source, 'paragraph');
  assert.equal(page.description.truncated, true);
  assert.ok(page.description.value.endsWith('mobile app on ...'));
  assert.equal(page.image.source, 'content');
  assert.equal(page.og.image, `${MEDIA}/spring-square.jpg`);
  assert.equal(page.imageAlt.value, '');
  assert.equal(page.url, 'https://www.northwind-bank.example/offers/spring-savings');
  assert.equal(page.images.length, 2);
});

test('reads values from the Metadata block', async () => {
  const { page } = await load('everyday-checking', '/accounts/everyday-checking');
  assert.equal(page.hasMetadataBlock, true);
  assert.equal(page.title.value, 'Everyday Checking with No Monthly Fees');
  assert.equal(page.title.source, 'metadata');
  assert.equal(page.description.source, 'metadata');
  assert.equal(page.image.source, 'metadata');
  assert.equal(page.og.image, `${MEDIA}/checking-card.jpg`);
  assert.equal(page.imageAlt.source, 'metadata');
  assert.equal(page.og.siteName, 'Northwind Bank');
  assert.equal(page.paragraphs.some((p) => p.includes('Get paid up to two days')), false);
});

test('puts back the Metadata block that the EW live document leaves out', async () => {
  const { doc: saved } = await load('everyday-checking');
  const live = parseHtml(saved.querySelector('main').outerHTML, DOMParser);
  live.querySelector('div.metadata').remove();
  assert.equal(extractPage(live, OPTS).title.source, 'h1');

  const merged = extractPage(withSavedMetadata(live, saved), { ...OPTS, path: '/accounts/everyday-checking' });
  assert.equal(merged.hasMetadataBlock, true);
  assert.equal(merged.metadataBlockCount, 1);
  assert.equal(merged.title.value, 'Everyday Checking with No Monthly Fees');
  assert.equal(merged.og.image, `${MEDIA}/checking-card.jpg`);
  assert.equal(merged.paragraphs.some((p) => p.includes('Get paid up to two days')), false);

  // Live HTML that already has every block is left alone; no saved block, nothing to add.
  const full = parseHtml(saved.querySelector('main').outerHTML, DOMParser);
  assert.equal(extractPage(withSavedMetadata(full, saved), OPTS).metadataBlockCount, 1);
  const bare = parseHtml('<main><div><h1>Plain page</h1></div></main>', DOMParser);
  assert.equal(extractPage(withSavedMetadata(bare, null), OPTS).hasMetadataBlock, false);
  assert.equal(extractPage(withSavedMetadata(bare, parseHtml('<main><div></div></main>', DOMParser)), OPTS).hasMetadataBlock, false);
});

test('the metadata signature tracks text rows, not images', async () => {
  const { doc } = await load('everyday-checking');
  const before = metadataSignature(doc);
  assert.match(before, /^title=Everyday Checking with No Monthly Fees$/m);
  assert.doesNotMatch(before, /^image=/m);
  doc.querySelector('div.metadata img')?.setAttribute('src', '/other.jpg');
  assert.equal(metadataSignature(doc), before);
  assert.equal(metadataSignature(parseHtml('<main><div><p>x</p></div></main>', DOMParser)), '');
  assert.equal(metadataSignature(null), '');
});

test('an empty Title row means no title, with no fallback', () => {
  const html = '<main><div><h1>Heading</h1><div class="metadata"><div><div>Title</div><div></div></div></div></div></main>';
  const page = extractPage(parseHtml(html, DOMParser), OPTS);
  assert.equal(page.title.value, '');
  assert.equal(page.title.source, 'empty');
  const result = runChecks(page);
  assert.ok(ids(result).includes('title-missing'));
});

test('bulk metadata applies underneath the block and suffixes are added', () => {
  const html = '<main><div><h1>Rates</h1><div class="metadata"><div><div>Title</div><div>Today’s rates</div></div></div></div></main>';
  const page = extractPage(parseHtml(html, DOMParser), {
    ...OPTS, bulk: { 'title:suffix': '| Northwind Bank', 'og:site_name': 'Northwind Bank', title: 'Bulk' },
  });
  assert.equal(page.title.value, 'Today’s rates');
  assert.equal(page.title.full, 'Today’s rates | Northwind Bank');
  assert.equal(page.og.siteName, 'Northwind Bank');
});

test('flags the problems on the broken demo page', async () => {
  const { page } = await load('spring-savings', '/offers/spring-savings');
  const result = runChecks(page, { images: IMAGES, index: await index() });
  const found = ids(result);
  ['title-truncated', 'description-auto', 'image-ratio', 'image-alt-missing', 'description-duplicate']
    .forEach((id) => assert.ok(found.includes(id), `expected ${id} in ${found.join(', ')}`));
  const ratio = result.checks.find((c) => c.id === 'image-ratio');
  assert.match(ratio.title, /50%/);
  assert.match(ratio.detail, /LinkedIn, Facebook, X, WhatsApp, Teams/);
  assert.ok(result.score < 60, `score ${result.score}`);
});

test('the good demo page passes', async () => {
  const { page } = await load('everyday-checking', '/accounts/everyday-checking');
  const result = runChecks(page, { images: IMAGES, index: await index() });
  assert.equal(result.counts.error, 0, ids(result).join(', '));
  assert.equal(result.counts.warning, 0, ids(result).join(', '));
  assert.equal(result.score, 100);
});

test('suggests a fitting title, a fresh description and the wide image', async () => {
  const { page } = await load('spring-savings', '/offers/spring-savings');
  const proposal = buildProposal(page, { images: IMAGES, index: await index() });
  const value = (name) => proposal.fields.find((f) => f.name === name).after;
  assert.equal(value('title'), 'Earn 4.50% APY on a Northwind High-Yield Savings Account');
  assert.equal(value('description'), 'Open a High-Yield Savings account between March 1 and May 31 and earn 4.50% APY for your first 12 months. There is no minimum opening deposit.');
  assert.equal(value('image'), '/tools/shareready/demo/media/spring-banner.jpg');
  assert.match(value('image-alt'), /^Piggy bank/);
  assert.ok(proposal.fields.every((f) => f.changed));
});

test('applying the fix clears the warnings', async () => {
  const { doc, page } = await load('spring-savings', '/offers/spring-savings');
  const idx = await index();
  const proposal = buildProposal(page, { images: IMAGES, index: idx });
  const rows = mergeRows(page, proposal);
  const table = toTableHtml(rows);
  assert.ok(table.startsWith('<table><tbody><tr><td colspan="2"><p>metadata</p></td></tr>'));
  assert.ok(table.includes('<tr><td><p>Title</p></td><td><p>Earn 4.50% APY'));
  assert.ok(table.includes('<img src="/tools/shareready/demo/media/spring-banner.jpg" alt="Piggy bank'));
  applyToDocument(doc, rows);
  const fixed = extractPage(doc, { ...OPTS, path: '/offers/spring-savings' });
  assert.equal(fixed.hasMetadataBlock, true);
  assert.equal(fixed.image.src, '/tools/shareready/demo/media/spring-banner.jpg');
  const result = runChecks(fixed, { images: IMAGES, index: idx });
  assert.equal(result.counts.error, 0, ids(result).join(', '));
  assert.equal(result.counts.warning, 0, ids(result).join(', '));
});

test('merging keeps unknown rows and existing labels', async () => {
  const { page } = await load('everyday-checking', '/accounts/everyday-checking');
  const proposal = buildProposal(page, { images: IMAGES });
  assert.equal(proposal.changed, false);
  const rows = mergeRows(page, proposal);
  assert.deepEqual(rows.map((r) => r.label), ['Title', 'Description', 'Image', 'Image Alt', 'og:site_name']);
});

test('escapes author text in the generated table', () => {
  const page = extractPage(parseHtml('<main><div><h1>A &lt;b&gt; "quoted" title here</h1></div></main>', DOMParser), OPTS);
  const rows = mergeRows(page, buildProposal(page));
  assert.ok(toTableHtml(rows).includes('A &lt;b&gt; &quot;quoted&quot; title here'));
});

test('recognises a selection inside the Metadata table only', async () => {
  const { page } = await load('everyday-checking', '/accounts/everyday-checking');
  const inTable = '<table><tbody><tr><td><p>Monthly</p></td></tr></tbody></table>';
  assert.equal(selectionInMetadata(inTable, page, DOMParser), true);
  const acrossCells = '<table><tbody><tr><td><p>Title</p></td><td><p>Everyday Checking</p></td></tr>'
    + '<tr><td><p>Descr</p></td></tr></tbody></table>';
  assert.equal(selectionInMetadata(acrossCells, page, DOMParser), true);
  assert.equal(selectionInMetadata('<p>Monthly</p>', page, DOMParser), false);
  assert.equal(selectionInMetadata('<table><tr><td>Elsewhere</td></tr></table>', page, DOMParser), false);
});

test('title suggestion keeps titles that already fit', () => {
  const page = extractPage(parseHtml('<main><div><h1>Mortgage rates today</h1></div></main>', DOMParser), OPTS);
  assert.equal(suggestTitle(page), 'Mortgage rates today');
});

test('pixel truncation and wrapping', () => {
  setMeasurer((value) => value.length * 10);
  try {
    const cut = truncateToWidth('one two three four five six', '20px Arial', 120);
    assert.equal(cut.truncated, true);
    assert.equal(cut.text, 'one two ...');
    const wrapped = wrapLines('one two three four five six seven', '14px Arial', 100, 2);
    assert.deepEqual(wrapped.lines, ['one two', 'three…']);
    assert.equal(wrapped.truncated, true);
  } finally {
    setMeasurer(null);
  }
});

test('image layout per platform', () => {
  const linkedin = getPlatform('linkedin');
  assert.deepEqual(imageLayout(linkedin, { ok: true, width: 400, height: 400 }), { mode: 'thumb', cropPct: 0 });
  assert.equal(imageLayout(linkedin, { ok: true, width: 800, height: 800 }).cropPct, 48);
  assert.equal(imageLayout(linkedin, { ok: true, width: 1200, height: 627 }).cropPct, 0);
  assert.equal(imageLayout(getPlatform('slack'), { ok: true, width: 800, height: 800 }).cropPct, 0);
  assert.equal(imageLayout(linkedin, { ok: false }).mode, 'missing');
});
