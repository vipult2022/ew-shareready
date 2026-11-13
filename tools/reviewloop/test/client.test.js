import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import { compare } from '../lib/page.js';
import { headMetaUnits, crossComparable } from '../lib/blocks.js';
import { locate, quotes } from '../lib/comments.js';
import { parseConfig, splitList, dueDate } from '../lib/config.js';
import { createApi, createDemoApi, workerBase } from '../lib/api.js';
import { createPayload, resubmitPayload } from '../lib/requests.js';
import { adfToText } from '../lib/adf.js';

const DEMO = new URL('../demo/', import.meta.url);
const fixture = (name) => readFile(new URL(`spring-savings.${name}.plain.html`, DEMO), 'utf8');

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

const page = {
  org: 'northwind', site: 'website', path: '/offers/spring-savings', webPath: '/offers/spring-savings',
};

test('quotes and locate: reviewer quotes map to the part of the page they name', async () => {
  const comment = 'In the intro, please change “by May 31 and earn 4.50% APY for your first 12 months” to “… (variable rate) …”.';
  assert.equal(quotes(comment).length, 2);
  const before = compare({ preview: await fixture('review1'), live: await fixture('live') }, null, DOMParser);
  assert.deepEqual(locate(comment, before.units).found, ['Top of page']);
  const after = compare({ preview: await fixture('review2'), live: await fixture('live') }, null, DOMParser);
  assert.deepEqual(locate(comment, after.units).found, []);
  assert.equal(locate('Looks good to me', after.units), null);
  assert.deepEqual(locate('Title should not say "Spring Savings at Northwind Bank"', after.units).found, ['Page metadata › Title']);
});

test('compare: since live, and since the last review via its snapshot', async () => {
  const live = await fixture('live');
  const first = compare({ preview: await fixture('review1'), live }, null, DOMParser);
  assert.equal(first.sinceLive.length, 8);
  assert.equal(first.sinceReview, null);
  const second = compare({ preview: await fixture('review2'), live }, first.snapshot, DOMParser);
  assert.equal(second.sinceReview.length, 1);
  assert.equal(second.sinceReview[0].location, 'Top of page');
  const unpublished = compare({ preview: live, live: null }, null, DOMParser);
  assert.equal(unpublished.firstVersion, true);
});

test('parseConfig: settings, custom review types and safe defaults', () => {
  const config = parseConfig({
    ':names': ['reviewloop', 'reviewloop-types'],
    reviewloop: { data: [{ key: 'worker-url', value: 'https://rl.example.workers.dev' }, { key: 'due-days', value: '3' }, { key: 'evil', value: 'x' }] },
    'reviewloop-types': { data: [{ Type: 'Legal', Assignee: 'Arjun', Checklist: 'Rates; Disclaimers' }, { Type: '' }] },
  });
  assert.equal(config.workerUrl, 'https://rl.example.workers.dev');
  assert.equal(config.dueDays, 3);
  assert.equal(config.requireApproval, false);
  assert.equal(config.types.length, 1);
  assert.deepEqual(config.types[0], {
    name: 'Legal', assignee: 'Arjun', checklist: ['Rates', 'Disclaimers'], dueDays: 3,
  });
  assert.equal(config.custom, true);
  const empty = parseConfig(null);
  assert.equal(empty.workerUrl, '');
  assert.equal(empty.requireApproval, false);
  const strict = parseConfig({ reviewloop: { data: [{ key: 'require-approval', value: 'Yes' }] } });
  assert.equal(strict.requireApproval, true);
  assert.deepEqual(empty.types.map((t) => t.name), ['Legal', 'Brand', 'Copy']);
  assert.deepEqual(splitList('a; b\nc;;'), ['a', 'b', 'c']);
  assert.match(dueDate(2), /^\d{4}-\d{2}-\d{2}$/);
});

test('workerBase: only https (or localhost) worker URLs are used', () => {
  assert.equal(workerBase('https://rl.example.workers.dev/'), 'https://rl.example.workers.dev');
  assert.equal(workerBase('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(workerBase('http://evil.example'), null);
  assert.equal(workerBase('ftp://files.example'), null);
  assert.equal(workerBase(''), null);
});

test('demo api: request, changes, fix, resend, approve, publish', async () => {
  const storage = memoryStorage();
  const api = createDemoApi({ fixture, storage, latency: 0 });
  const other = createDemoApi({ fixture, storage, latency: 0 });
  const v1 = await api.versions();
  const c1 = compare(v1, null, DOMParser);
  const args = {
    page, title: 'Spring Savings', note: '', requester: 'Priya Shah', compared: c1,
  };
  const created = await api.create(createPayload({ ...args, type: { name: 'Legal', assignee: 'Arjun Mehta' }, due: '2026-11-16' }));
  assert.equal(created.key, 'NWB-42');
  // A second frame (the panel) sees the review the dialog created.
  assert.equal((await other.get()).review.key, 'NWB-42');
  other.reviewer('changes');
  assert.equal((await api.get()).review.state, 'changes');
  api.fix();
  const { review } = await api.get();
  const c2 = compare(await api.versions(), review.snapshot, DOMParser);
  assert.equal(c2.sinceReview.length, 1);
  const body = resubmitPayload({
    ...args, review, note: 'Added it.', compared: c2,
  });
  assert.match(adfToText(body.comment), /variable rate/);
  await api.resubmit(body);
  assert.equal((await other.get()).review.round, 2);
  other.reviewer('approve');
  assert.equal((await api.get()).review.state, 'approved');
  await api.published();
  assert.equal((await other.get()).review.state, 'done');
  api.reset();
  assert.equal((await other.get()).review, null);
});

test('createPayload: Jira summary and description from the comparison', async () => {
  const compared = compare({ preview: await fixture('review1'), live: await fixture('live') }, null, DOMParser);
  const body = createPayload({
    page, title: 'Spring Savings', type: { name: 'Brand', checklist: ['Tone'] }, due: '', note: 'Hi', requester: 'Priya', compared,
  });
  assert.equal(body.summary, 'Brand review: Spring Savings');
  const text = adfToText(body.description);
  assert.match(text, /Tone/);
  assert.match(text, /4\.50%/);
  assert.equal(body.snapshot.complete, true);
});

test('api: reads retry once after a dropped connection, writes never do', async () => {
  /* global globalThis */
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ review: null }), { status: 200 });
  };
  try {
    const api = createApi({ workerUrl: 'https://rl.example.workers.dev', getToken: () => 't' });
    const got = await api.get({ path: '/x' });
    assert.equal(got.ok, true);
    assert.equal(calls.length, 2);

    calls.length = 0;
    const made = await api.create({ path: '/x' });
    assert.equal(made.ok, false);
    assert.match(made.error, /Could not reach/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const DA_DRAFT = `<body><header></header><main><div><h1>Summer CD: 5.25% APY</h1>
<picture><img src="https://content.da.live/nw/site/media/sun.jpg" alt="Sun"></picture>
<p>See <a href="https://main--site--nw.aem.page/rates">rates</a>.</p>
<div class="metadata"><div><div><p>Title</p></div><div><p>Summer CD</p></div></div>
<div><div><p>Description</p></div><div><p>Lock in 5.25%.</p></div></div>
<div><div><p>Image</p></div><div><picture><img src="https://content.da.live/nw/site/media/sun.jpg" alt="Sun"></picture></div></div>
</div></div></main><footer></footer></body>`;
const LIVE_MAIN = `<div><h1 id="x">Summer CD: 5.00% APY</h1>
<p><picture><img src="./media_1abcdef0123456789abcdef.jpg?width=750" alt="Sun"></picture></p>
<p>See <a href="/rates">rates</a>.</p></div>`;
const LIVE_HEAD = `<title>Summer CD</title><meta name="description" content="Lock in 5.00%.">
<meta property="og:image" content="https://main--site--nw.aem.live/media_1abcdef0123456789abcdef.jpg?width=1200">`;

test('compare: a DA draft against live finds only real edits, metadata included', () => {
  const r = compare({
    preview: DA_DRAFT, live: LIVE_MAIN, liveHead: LIVE_HEAD, source: 'da',
  }, null, DOMParser);
  const what = r.sinceLive.map((c) => `${c.type} ${c.location}${c.label ? ` ${c.label}` : ''}`);
  assert.deepEqual(what, ['changed Page title (H1)', 'changed Page metadata Description']);
  assert.equal(r.units.find((u) => u.kind === 'image').src, 'https://content.da.live/nw/site/media/sun.jpg', 'snapshots keep the real file');
});

test('headMetaUnits and crossComparable', () => {
  const meta = headMetaUnits(LIVE_HEAD, ['Title', 'Description', 'Image', 'Robots'], DOMParser);
  assert.deepEqual(meta.map((m) => [m.label, m.text]), [['Title', 'Summer CD'], ['Description', 'Lock in 5.00%.'], ['Image', '']]);
  const [link] = crossComparable([{ kind: 'text', text: 'x', links: ['https://main--a--b.aem.live/rates', 'https://example.com/'] }]);
  assert.deepEqual(link.links, ['/rates', 'https://example.com/']);
});
