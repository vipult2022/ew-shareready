import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyze, altFromName, headingScale, isButton, ordered, sectionItems,
} from '../lib/design.js';
import {
  convert, itemHtml, itemsHtml, safeHref, documentHtml, cleanPath, suggestPath, blockTable,
} from '../lib/convert.js';
import buildPrompt from '../lib/prompt.js';
import {
  designCheck, norm, textOf, linksOf, imagesOf,
} from '../lib/check.js';
import { parseSettings } from '../lib/config.js';
import { copyImages, slug, cleanFolder } from '../lib/images.js';
import { demoConnection, workerConnection, ConnectionError } from '../lib/connection.js';

const [SAMPLE] = JSON.parse(readFileSync(new URL('../demo/handoff.json', import.meta.url)));
const SCRIPT_URL = ['java', 'script:alert(1)'].join('');
const src = (id) => `https://content.da.live/o/r/media/figma/${id}.jpg`;

let n = 0;
const T = (text, size = 16, extra = {}) => {
  n += 1;
  return {
    type: 'TEXT', id: `t${n}`, name: text, x: 0, y: 0, w: 300, h: 20, text, size, ...extra,
  };
};
const F = (name, children, extra = {}) => {
  n += 1;
  return {
    type: 'FRAME', id: `f${n}`, name, x: 0, y: 0, w: 400, h: 200, layout: 'VERTICAL', children, ...extra,
  };
};

/* lib/design.js */

test('altFromName keeps describing names and drops Figma defaults', () => {
  assert.equal(altFromName('family_on-porch.jpg'), 'Family on porch');
  assert.equal(altFromName('Rectangle 12'), '');
  assert.equal(altFromName('Image'), '');
  assert.equal(altFromName('Frame 3 copy'), '');
  assert.equal(altFromName('bg'), '');
  assert.equal(altFromName(''), '');
});

test('headingScale reads the body size from the most text', () => {
  const root = F('r', [T('Big title', 48), T('A long paragraph of body copy that sets the size.', 16), T('Sub', 24), T('Tiny', 12)]);
  assert.deepEqual(headingScale(root), { body: 16, sizes: [48, 24] });
});

test('isButton spots small filled frames and button-named frames', () => {
  assert.ok(isButton(F('x', [T('Apply now')], { filled: true, w: 200, h: 48 })));
  assert.ok(isButton(F('CTA', [T('Find out more about rates')], { w: 600, h: 120 })));
  assert.ok(!isButton(F('x', [T('Apply now')], { filled: false, w: 200, h: 48 })));
  assert.ok(!isButton(F('x', [T('One'), T('Two')], { filled: true, w: 200, h: 48 })));
  assert.ok(!isButton(T('Apply')));
});

test('ordered reads rows left to right when there is no auto layout', () => {
  const a = T('a', 16, { x: 300, y: 5 });
  const b = T('b', 16, { x: 0, y: 0 });
  const c = T('c', 16, { x: 0, y: 100 });
  const hidden = T('h', 16, { visible: false });
  assert.deepEqual(ordered(F('r', [c, a, b, hidden], { layout: 'NONE' })).map((x) => x.text), ['b', 'a', 'c']);
});

test('analyze maps the sample to Hero, Cards, Columns, Accordion and text', () => {
  const model = analyze(SAMPLE);
  assert.deepEqual(model.sections.map((s) => s.block), ['Hero', 'Cards', 'Columns', 'Accordion', 'Text']);
  assert.equal(model.title, 'Your first home, made simpler');
  assert.match(model.description, /^Fixed rates from 5\.9% APR/);
  assert.deepEqual(model.stats, {
    texts: 22, images: 5, buttons: 4, sections: 5,
  });
  const h1 = model.items.filter((it) => it.kind === 'heading' && it.level === 1);
  assert.equal(h1.length, 1);
  const cards = model.sections[1];
  assert.equal(cards.rows.length, 3);
  assert.equal(cards.rows[0][0][0].kind, 'image');
  assert.equal(cards.lead[0].text, 'Why buyers choose Northwind');
  assert.equal(model.sections[3].rows[0][0][0].text, 'How much deposit do I need?');
  const hero = model.items[0];
  assert.equal(hero.alt, 'Family carrying moving boxes into their new home');
  assert.deepEqual(model.warnings.map((w) => w.kind), ['link', 'alt', 'skipped']);
});

test('frame names force a block', () => {
  const model = analyze({
    name: 'x',
    tree: F('Page', [
      F('Table: rates', [
        F('row', [F('c', [T('Term')]), F('c', [T('Rate')])], { layout: 'HORIZONTAL' }),
        F('row', [F('c', [T('5 years')]), F('c', [T('5.9%')])], { layout: 'HORIZONTAL' }),
      ]),
      F('Text', [T('Plain words', 16)]),
    ]),
  });
  assert.deepEqual(model.sections.map((s) => s.block), ['Table', 'Text']);
  assert.deepEqual(model.sections[0].rows[1].map((c) => c[0].text), ['5 years', '5.9%']);
  assert.ok(model.warnings.some((w) => w.kind === 'h1'));
});

test('analyze copes with an empty or missing tree', () => {
  assert.equal(analyze(null).sections.length, 0);
  assert.equal(analyze({ name: 'x', tree: F('Empty', []) }).sections.length, 0);
});

test('sectionItems lists lead, cells and default content', () => {
  const model = analyze(SAMPLE);
  assert.equal(model.sections.flatMap(sectionItems).length, model.items.length);
});

/* lib/convert.js */

test('safeHref blocks script and protocol-relative links', () => {
  assert.equal(safeHref('/loans'), '/loans');
  assert.equal(safeHref('https://x.com/?a=1&b=2'), 'https://x.com/?a=1&amp;b=2');
  assert.equal(safeHref(SCRIPT_URL), '');
  assert.equal(safeHref('//evil.com'), '');
});

test('itemHtml escapes text and marks primary and secondary buttons', () => {
  assert.equal(itemHtml({ kind: 'heading', level: 2, text: 'A <b>' }), '<h2>A &lt;b&gt;</h2>');
  assert.equal(itemHtml({ kind: 'text', text: 'a\nb' }), '<p>a<br>b</p>');
  assert.equal(itemsHtml([
    { kind: 'button', text: 'Go', link: '/go' },
    { kind: 'button', text: 'More', link: '' },
  ]), '<p><strong><a href="/go">Go</a></strong></p><p><em><a href="#">More</a></em></p>');
  assert.equal(itemHtml({ kind: 'image', image: 'x', alt: 'A "cat"' }, { imageSrc: src }), `<p><picture><img src="${src('x')}" alt="A &quot;cat&quot;"></picture></p>`);
  assert.equal(itemHtml({ kind: 'image', image: 'x' }, { imageSrc: () => '' }), '');
});

test('convert builds DA blocks, sections and metadata', () => {
  const { sections, html } = convert(analyze(SAMPLE), { imageSrc: src });
  assert.equal(sections.length, 5);
  assert.match(sections[0], /^<table><tbody><tr><td colspan="1"><p>Hero<\/p>/);
  assert.match(sections[1], /<p>Cards<\/p>/);
  assert.match(sections[2], /<td colspan="2"><p>Columns<\/p>/);
  assert.match(sections[3], /<p>Accordion<\/p>/);
  assert.match(sections[4], /<p>Metadata<\/p>/);
  assert.equal(html.split('<hr>').length, 5);
  const plain = convert(analyze(SAMPLE), { imageSrc: src, metadata: false });
  assert.doesNotMatch(plain.html, /Metadata/);
  assert.equal(blockTable('Table (no header)', [['a', 'b']]), '<table><tbody><tr><td colspan="2"><p>Table (no header)</p></td></tr><tr><td>a</td><td>b</td></tr></tbody></table>');
});

test('documentHtml, cleanPath and suggestPath', () => {
  assert.equal(documentHtml(['<p>a</p>', '<p>b</p>']), '<body><header></header><main><div><p>a</p></div><div><p>b</p></div></main><footer></footer></body>');
  assert.equal(cleanPath('https://x.aem.page/Offers/Spring Sale 2027.html'), '/offers/spring-sale-2027');
  assert.equal(cleanPath('../..'), '');
  assert.equal(suggestPath(SAMPLE), '/loans/home-loans');
  assert.equal(suggestPath({ name: 'Rates / Summer' }, '/drafts/'), '/drafts/rates-summer');
  assert.equal(suggestPath({}, ''), '/figma-page');
});

/* lib/prompt.js */

test('buildPrompt keeps text verbatim and lists blocks, pictures and buttons', () => {
  const prompt = buildPrompt(SAMPLE, analyze(SAMPLE), { imageSrc: src, blocks: ['Hero', 'Cards'] });
  assert.match(prompt, /Figma design “Home loans landing” sent by Maya Chen \(Design\)/);
  assert.match(prompt, /Keep every text exactly as written/);
  assert.match(prompt, /Use only these blocks from this site: Hero, Cards, Metadata\./);
  assert.match(prompt, /1\. Hero: Hero block\n {3}Image: https:\/\/content\.da\.live\/o\/r\/media\/figma\/hero\.jpg/);
  assert.match(prompt, /Button: “Talk to an advisor” → no link yet/);
  assert.match(prompt, /advisor\.jpg \(write short alt text/);
  assert.match(prompt, /5\. Closing call to action: default content/);
  assert.doesNotMatch(buildPrompt(SAMPLE, analyze(SAMPLE), { metadata: false }), /Metadata/);
});

/* lib/check.js */

test('norm and textOf ignore case, quotes, dashes, tags and entities', () => {
  assert.equal(norm('  It’s  “Ready” – now\u00a0'), 'it\'s "ready" - now');
  assert.equal(textOf('<p>Rates &amp; fees<br>today</p><style>p{}</style>'), 'rates & fees today');
  assert.deepEqual(linksOf('<a class="b" href="/x?a=1&amp;b=2"><b>Go</b></a>'), [{ href: '/x?a=1&b=2', text: 'go' }]);
  assert.deepEqual(imagesOf('<img alt=\'\' src="https://a/b/c.jpg?w=1">'), [{ src: 'https://a/b/c.jpg?w=1', alt: '' }]);
});

test('designCheck finds what is missing from the page', () => {
  const model = analyze(SAMPLE);
  const full = convert(model, { imageSrc: src }).html;
  const all = designCheck(model, full, { imageUrl: src });
  assert.equal(all.score, 100);
  assert.equal(all.missing.length, 0);
  assert.equal(all.total, 30);
  assert.ok(all.notes.some((t) => /Talk to an advisor/.test(t)));

  const partial = designCheck(model, '<h1>Your first home, made simpler</h1><img src="https://other/hero.jpg" alt="x">', { imageUrl: src });
  assert.equal(partial.groups.texts.found, 1);
  assert.equal(partial.groups.images.found, 1);
  assert.equal(partial.groups.buttons.found, 0);
  assert.equal(partial.missing.length, partial.total - 2);
  assert.equal(designCheck(model, full, { imageUrl: () => '' }).groups.images.found, 0);
});

/* lib/config.js */

test('parseSettings reads the figma sheet and URL overrides', () => {
  const json = {
    figma: {
      data: [
        { key: 'worker-url', value: 'https://w.example.workers.dev/' },
        { key: 'new-page-folder', value: 'Drafts/Figma' },
        { key: 'blocks', value: 'Hero, Cards ,,Columns' },
        { key: 'unknown', value: 'x' },
      ],
    },
  };
  const out = parseSettings(json);
  assert.equal(out['worker-url'], 'https://w.example.workers.dev');
  assert.equal(out['new-page-folder'], '/drafts/figma');
  assert.deepEqual(out.blocks, ['Hero', 'Cards', 'Columns']);
  assert.equal(out['image-folder'], '/media/figma');
  assert.equal(out.unknown, undefined);
  assert.equal(parseSettings(json, '?worker-url=http://evil.com')['worker-url'], undefined);
  assert.equal(parseSettings(null, '?worker-url=http://localhost:8787')['worker-url'], 'http://localhost:8787');
});

/* lib/images.js */

test('slug and cleanFolder', () => {
  assert.equal(slug('Family on Porch.JPG'), 'family-on-porch');
  assert.equal(slug(''), 'image');
  assert.equal(cleanFolder('/media/../x'), '/media/x');
  assert.equal(cleanFolder(''), '/media/figma');
});

test('copyImages uploads each picture once and reports failures', async () => {
  const puts = [];
  const fetchImpl = async (url, init) => {
    puts.push({ url, init });
    return { ok: true };
  };
  const download = async (image) => {
    if (image === 'bad') throw new Error('gone');
    return new Blob([`bytes-${image}`], { type: 'image/jpeg' });
  };
  const progress = [];
  const { copied, failed } = await copyImages([
    { image: 'a', name: 'Hero photo' }, { image: 'a', name: 'Hero photo' }, { image: 'bad', name: 'x' },
  ], {
    org: 'o', repo: 'r', token: 'tk', folder: '/media/figma', prefix: 'home', download, fetchImpl, onProgress: (d, t) => progress.push(`${d}/${t}`),
  });
  assert.equal(puts.length, 1);
  assert.match(puts[0].url, /^https:\/\/admin\.da\.live\/source\/o\/r\/media\/figma\/home-hero-photo-[0-9a-f]{8}\.jpg$/);
  assert.equal(puts[0].init.headers.Authorization, 'Bearer tk');
  assert.match(copied.get('a'), /^https:\/\/content\.da\.live\/o\/r\/media\/figma\/home-hero-photo-/);
  assert.deepEqual(failed.map((f) => f.image), ['bad']);
  assert.deepEqual(progress.sort(), ['1/2', '2/2']);
});

/* lib/connection.js */

test('demoConnection lists, loads, serves pictures and tracks status', async () => {
  const fetched = [];
  const conn = demoConnection(structuredClone([SAMPLE]), {
    base: 'https://site/tools/figma/demo/',
    fetchImpl: async (url) => {
      fetched.push(url);
      return { ok: true, blob: async () => new Blob(['x']) };
    },
  });
  const list = await conn.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].tree, undefined);
  assert.equal((await conn.get(SAMPLE.id)).tree.name, 'Home loans landing');
  await conn.image(SAMPLE.id, 'hero');
  assert.deepEqual(fetched, ['https://site/tools/figma/demo/media/hero.jpg']);
  await conn.status(SAMPLE.id, 'built', '/loans/home-loans');
  assert.equal((await conn.list())[0].status, 'built');
  await assert.rejects(conn.get('nope'), ConnectionError);
});

test('workerConnection posts the site and IMS token and surfaces errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/handoffs')) return { ok: true, json: async () => ({ handoffs: [{ id: 'a' }] }) };
    if (url.endsWith('/handoff')) return { ok: true, json: async () => ({ handoff: { id: 'a', tree: {} } }) };
    return { ok: false, status: 403, json: async () => ({ error: 'Not allowed', code: 'site' }) };
  };
  const conn = workerConnection('https://w', async () => 'ims', { org: 'o', site: 's' }, fetchImpl);
  assert.deepEqual(await conn.list(), [{ id: 'a' }]);
  await conn.get('a');
  await conn.get('a');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ims');
  assert.deepEqual(JSON.parse(calls[1].init.body), { org: 'o', site: 's', id: 'a' });
  await assert.rejects(conn.status('a', 'built'), (e) => e.status === 403 && e.code === 'site' && e.message === 'Not allowed');
  await assert.rejects(conn.image('a', 'x'), /Not allowed/);
  const down = workerConnection('https://w', async () => 'ims', {}, async () => { throw new Error('net'); });
  await assert.rejects(down.list(), /Could not reach the Figma worker/);
});
