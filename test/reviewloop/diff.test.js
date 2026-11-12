import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import {
  parseHtml, readUnits, imageKey, blockTitle,
} from '../../tools/reviewloop/lib/blocks.js';
import {
  diffUnits, diffWords, wordEdits, summarize, changeTitle, toSnapshot, fromSnapshot,
} from '../../tools/reviewloop/lib/diff.js';

const DEMO = new URL('../../tools/reviewloop/demo/', import.meta.url);

async function units(name) {
  const html = await readFile(new URL(`spring-savings.${name}.plain.html`, DEMO), 'utf8');
  return readUnits(parseHtml(html, DOMParser));
}

function unitsOf(html) {
  return readUnits(parseHtml(html, DOMParser));
}

function edits(change) {
  return (change.edits || []).map(({ before, after }) => `${before} → ${after}`);
}

test('reads a .plain.html page into located units', async () => {
  const live = await units('live');
  assert.deepEqual(live[0], {
    kind: 'heading', location: 'Page title (H1)', text: 'Spring Savings: earn 4.25% APY', level: 1,
  });
  const earn = live.find((u) => u.text.startsWith('4.25% APY for 12 months'));
  assert.equal(earn.location, 'Columns › Earn more');
  const intro = live.find((u) => u.text.startsWith('Open a High-Yield'));
  assert.equal(intro.location, '“How the spring offer works”');
  const cta = live.find((u) => u.text === 'Open an account');
  assert.deepEqual(cta.links, ['https://www.northwind-bank.example/open']);
  const meta = live.filter((u) => u.kind === 'meta').map((u) => u.label);
  assert.deepEqual(meta, ['Title', 'Description']);
  assert.equal(live.filter((u) => u.kind === 'image').length, 2);
});

test('reads a DA source document the same way', async () => {
  const html = await readFile(new URL('../../tools/shareready/demo/spring-savings.html', import.meta.url), 'utf8');
  const doc = unitsOf(html);
  assert.equal(doc[0].kind, 'heading');
  assert.equal(doc[0].level, 1);
  assert.ok(doc.some((u) => u.location === 'Columns › Pay nothing'));
  assert.ok(doc.some((u) => u.kind === 'image' && u.src === '/tools/shareready/demo/media/spring-banner.jpg'));
});

test('image keys use the media hash, so preview and live compare', () => {
  assert.equal(imageKey('./media_1B8102f4c47387bb96af04c4012873a2566cd49da.jpg?width=750&format=jpg'), 'media_1b8102f4c47387bb96af04c4012873a2566cd49da');
  assert.equal(imageKey('https://example.com/a.png?x=1#y'), 'https://example.com/a.png');
  assert.equal(blockTitle('cards-wide'), 'Cards wide');
});

test('live → first review: only what changed, with before and after', async () => {
  const changes = diffUnits(await units('live'), await units('review1'));
  assert.equal(summarize(changes), '8 changes: 7 edited, 1 added');
  const [h1, hero, body, added, column, image, title, description] = changes;
  assert.equal(h1.location, 'Page title (H1)');
  assert.deepEqual(edits(h1), ['4.25% → 4.50%']);
  assert.equal(hero.location, 'Top of page');
  assert.deepEqual(edits(hero), ['April 30 → May 31', '4.25% → 4.50%']);
  assert.deepEqual(edits(body), ['April 30 → May 31', '4.25% → 4.50%']);
  assert.equal(added.type, 'added');
  assert.equal(changeTitle(added), 'Text added');
  assert.match(added.text, /^Already a customer/);
  assert.equal(column.location, 'Columns › Earn more');
  assert.equal(changeTitle(image), 'Image replaced');
  assert.equal(image.imageReplaced, true);
  assert.equal(changeTitle(title), 'Title changed');
  assert.equal(description.location, 'Page metadata');
});

test('second review shows only what changed since the first review', async () => {
  const changes = diffUnits(await units('review1'), await units('review2'));
  assert.equal(summarize(changes), '1 change: 1 edited');
  assert.deepEqual(edits(changes[0]), [' → (variable rate)']);
  assert.deepEqual(changes[0].words.filter((s) => s.op === 'ins'), [{ op: 'ins', text: '(variable rate)' }]);
});

test('identical pages and first versions', async () => {
  const live = await units('live');
  assert.deepEqual(diffUnits(live, live), []);
  assert.equal(summarize([]), 'No changes');
  const first = diffUnits([], live);
  assert.ok(first.every((c) => c.type === 'added'));
  assert.equal(first.length, live.length);
});

test('removed content, alt text and link-only changes', () => {
  const before = unitsOf(`<div><h1>Rates</h1>
    <p>Keep this.</p>
    <p>Old promo that ends soon.</p>
    <p><picture><img src="./media_aaaaaaaaaaaaaaaaaaaaaa.png" alt="Old alt"></picture></p>
    <p><a href="/old">Apply now</a></p></div>`);
  const after = unitsOf(`<div><h1>Rates</h1>
    <p>Keep this.</p>
    <p><picture><img src="./media_aaaaaaaaaaaaaaaaaaaaaa.png?width=750" alt="New alt"></picture></p>
    <p><a href="/new">Apply now</a></p></div>`);
  const changes = diffUnits(before, after);
  assert.deepEqual(changes.map(changeTitle), ['Text removed', 'Image alt text changed', 'Link changed']);
  assert.deepEqual(changes[2].links, { before: ['/old'], after: ['/new'] });
});

test('lists, tables and block rows get their own locations', () => {
  const page = unitsOf(`<div><h2>Fees</h2><ul><li>No monthly fee</li><li>Free ATMs</li></ul>
    <div class="cards"><div><div>Card one</div></div><div><div>Card two</div></div></div>
    <div class="section-metadata"><div><div>Style</div><div>dark</div></div></div></div>`);
  assert.deepEqual(page.map((u) => [u.kind, u.location, u.text]), [
    ['heading', 'Heading (H2)', 'Fees'],
    ['list', '“Fees”', 'No monthly fee'],
    ['list', '“Fees”', 'Free ATMs'],
    ['text', 'Cards › row 1', 'Card one'],
    ['text', 'Cards › row 2', 'Card two'],
    ['meta', 'Section settings', 'dark'],
  ]);
});

test('word diff and edits', () => {
  const words = diffWords('Earn 4.25% APY by April 30', 'Earn 4.50% APY by May 31 today');
  assert.deepEqual(words, [
    { op: 'same', text: 'Earn' },
    { op: 'del', text: '4.25%' },
    { op: 'ins', text: '4.50%' },
    { op: 'same', text: 'APY by' },
    { op: 'del', text: 'April 30' },
    { op: 'ins', text: 'May 31 today' },
  ]);
  assert.deepEqual(wordEdits(words), [
    { before: '4.25%', after: '4.50%' },
    { before: 'April 30', after: 'May 31 today' },
  ]);
});

test('snapshots round-trip and stay under the Jira property limit', async () => {
  const live = await units('live');
  const snap = toSnapshot(live);
  assert.equal(snap.complete, true);
  assert.deepEqual(diffUnits(fromSnapshot(snap), fromSnapshot(toSnapshot(live))), []);
  const big = Array.from({ length: 400 }, (_, i) => ({ kind: 'text', location: 'Top of page', text: `${i} ${'x'.repeat(200)}` }));
  const small = toSnapshot(big);
  assert.equal(small.complete, false);
  assert.ok(JSON.stringify(small).length <= 30100);
});
