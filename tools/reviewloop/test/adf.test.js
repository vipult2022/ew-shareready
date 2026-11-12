import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import { parseHtml, readUnits } from '../lib/blocks.js';
import { diffUnits } from '../lib/diff.js';
import {
  reviewDescription, rereviewComment, publishedComment, changesTable, trimContext, adfToText,
} from '../lib/adf.js';

const DEMO = new URL('../demo/', import.meta.url);
const page = {
  title: 'Spring Savings',
  path: '/offers/spring-savings',
  previewUrl: 'https://main--site--org.aem.page/offers/spring-savings',
  editUrl: 'https://da.live/canvas#/org/site/offers/spring-savings',
  liveUrl: 'https://main--site--org.aem.live/offers/spring-savings',
};

async function units(name) {
  const html = await readFile(new URL(`spring-savings.${name}.plain.html`, DEMO), 'utf8');
  return readUnits(parseHtml(html, DOMParser));
}

/** Every node type and mark used must be valid ADF for Jira Cloud. */
const NODES = new Set(['doc', 'paragraph', 'text', 'heading', 'table', 'tableRow', 'tableHeader', 'tableCell', 'panel', 'bulletList', 'listItem']);
const MARKS = new Set(['strong', 'em', 'strike', 'link', 'textColor']);
function assertValid(node) {
  assert.ok(NODES.has(node.type), `unexpected node ${node.type}`);
  if (node.type === 'text') {
    assert.ok(node.text.length > 0, 'ADF text nodes must not be empty');
    (node.marks || []).forEach((m) => assert.ok(MARKS.has(m.type), `unexpected mark ${m.type}`));
  }
  (node.content || []).forEach(assertValid);
}

test('review description: request, links, note, change table and checklist', async () => {
  const changes = diffUnits(await units('live'), await units('review1'));
  const doc = reviewDescription({
    page,
    requester: 'Priya Shah',
    reviewType: 'Legal',
    note: 'Rate approved by Treasury on 10 Nov.',
    checklist: ['Rate and APY wording', 'Disclaimer present'],
    changes,
  });
  assertValid(doc);
  const plain = adfToText(doc);
  assert.match(plain, /Priya Shah asks for a Legal review of “Spring Savings” \(\/offers\/spring-savings\)\./);
  assert.match(plain, /Preview · Open in Experience Workspace · Live page/);
  assert.match(plain, /Rate approved by Treasury/);
  assert.match(plain, /What changed since the live page \(8 changes: 7 edited, 1 added\)/);
  assert.match(plain, /☐ Disclaimer present/);
  const table = doc.content.find((n) => n.type === 'table');
  assert.equal(table.content.length, 9);
  const h1Row = table.content[1].content.map(adfToText).map((s) => s.trim());
  assert.deepEqual(h1Row, ['Page title (H1)', 'Heading changed', 'Spring Savings: earn 4.25% 4.50% APY']);
  const struck = table.content[1].content[2].content[0].content.find((n) => n.text === '4.25%');
  assert.deepEqual(struck.marks.map((m) => m.type), ['strike', 'textColor']);
});

test('first version and re-review comment', async () => {
  const first = reviewDescription({ page, firstVersion: true, reviewType: 'Brand' });
  assertValid(first);
  assert.match(adfToText(first), /never been published/);

  const changes = diffUnits(await units('review1'), await units('review2'));
  const comment = rereviewComment({
    page, requester: 'Priya Shah', changes, round: 2, note: 'Added the variable rate wording.',
  });
  assertValid(comment);
  const plain = adfToText(comment);
  assert.match(plain, /Priya Shah sent the page back for review \(round 2\)\./);
  assert.match(plain, /What changed since the last review \(1 change: 1 edited\)/);
  assert.match(plain, /\(variable rate\)/);

  const none = rereviewComment({ page, changes: [] });
  assert.match(adfToText(none), /No content changes since the last review\./);
});

test('published comment flags edits after approval', () => {
  const ok = publishedComment({ liveUrl: page.liveUrl, publisher: 'Priya Shah' });
  assertValid(ok);
  assert.equal(adfToText(ok).trim(), `Published by Priya Shah: ${page.liveUrl}`);
  const late = publishedComment({ liveUrl: page.liveUrl, editsSinceApproval: 2 });
  assert.match(adfToText(late), /Published with 2 edits made after approval\./);
  const early = publishedComment({ liveUrl: page.liveUrl, notApproved: 'In review' });
  assertValid(early);
  assert.match(adfToText(early), /Published before approval \(status: In review\)/);
});

test('long unchanged text is trimmed around the edit', () => {
  const words = 'one two three four five six seven eight nine ten';
  assert.deepEqual(trimContext([
    { op: 'same', text: words },
    { op: 'del', text: 'x' },
    { op: 'same', text: `${words} ${words}` },
    { op: 'ins', text: 'y' },
    { op: 'same', text: words },
  ]).map((s) => s.text), [
    '… five six seven eight nine ten',
    'x',
    'one two three four five six … five six seven eight nine ten',
    'y',
    'one two three four five six …',
  ]);
});

test('link and image changes render in the table', () => {
  const table = changesTable([
    {
      type: 'changed', kind: 'text', location: 'Top of page', before: 'Apply', after: 'Apply', links: { before: ['/old'], after: ['/new'] },
    },
    {
      type: 'changed', kind: 'image', location: 'Top of page', before: 'a', after: 'a', imageReplaced: true,
    },
    {
      type: 'removed', kind: 'image', location: 'Top of page', text: '',
    },
  ]);
  assertValid({ type: 'doc', content: [table] });
  const cells = table.content.slice(1).map((row) => adfToText(row.content[2]).trim());
  assert.deepEqual(cells, ['link: /old → /new', 'new image: “a”', '(image)']);
});

test('a very long change list is capped to stay inside Jira limits', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    type: 'added', kind: 'text', location: `Section ${i}`, text: 'word '.repeat(40),
  }));
  const table = changesTable(many);
  assert.ok(JSON.stringify(table).length < 26000);
  assert.match(adfToText(table.content.at(-1)), /\d+ more changes: open the preview/);
  assert.equal(changesTable(many.slice(0, 3)).content.length, 4);
});
