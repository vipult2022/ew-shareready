import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { parseHtml, blockElements, classesOf } from '../lib/live.js';
import {
  parseRules, blockRules, libraryBlock, exampleFieldsFor, exampleRulesFor,
} from '../lib/rules.js';
import {
  codeNoun, suggestNames, fieldsTable, pickExample, exampleFromBlock, withFieldsTable,
  withLibraryRows, daSource, daEditUrl, libraryPageFor, planNames, saveNames, namesKey,
  fieldRulesTable, limitsChange,
} from '../lib/naming.js';

const blockOf = (html) => blockElements(parseHtml(`<main><div>${html}</div></main>`, DOMParser))[0];
const labelsOf = (rows) => rows.map((row) => (row.option ? 'option' : row.cells.map((cell) => cell.map((f) => f.label))));

const CAROUSEL = `<div class="carousel media-left">
  <div><div><picture><img src="./media_1.jpg" alt="Keys"></picture></div><div><p>Easy access</p><h3>Instant Saver</h3><p>Move money whenever you like.</p><p>Interest is paid monthly.</p><p><strong><a href="/save">Open</a></strong></p></div></div>
  <div><div><picture><img src="./media_2.jpg" alt=""></picture></div><div><h3>Fixed Bond</h3><p>Lock in a rate.</p></div></div>
  <div><div>theme</div><div>surface-light</div></div>
</div>`;
const CAROUSEL_RULES = blockRules(parseRules([
  { block: 'carousel', field: 'description', max: '160' },
  { block: 'carousel', field: 'eyebrow', label: 'Kicker' },
]), 'carousel');
const CAROUSEL_HINTS = { noun: 'Slide', knownKeys: new Set(['theme']) };

const HERO = `<div class="hero">
  <div><div><picture><img src="./media_h.jpg" alt="Home"></picture><h1>Savings that grow</h1><p>Open an account in minutes.</p><p><strong><a href="/open">Open an account</a></strong></p></div></div>
  <div><div>theme</div><div>dark</div></div>
</div>`;

test('naming: the code names the item, skipping words that are parts of one', () => {
  assert.equal(codeNoun(readFileSync(new URL('../../../blocks/cards/cards.js', import.meta.url), 'utf8'), 'cards'), 'Card');
  const carousel = "slide.classList.add('carousel-slide'); el.className = 'carousel-slides-container'; li.classList.add('carousel-slide-indicator'); div.className = 'carousel-navigation-buttons'; x.classList.add('carousel-slide-image');";
  assert.equal(codeNoun(carousel, 'carousel'), 'Slide');
  assert.equal(codeNoun("d.className = 'accordion-item'; s.className = 'accordion-item-label';", 'accordion'), '', 'generic words are not nouns');
  assert.equal(codeNoun('', 'cards'), '');
});

test('naming: a block of items is named by its first item, with the noun and the site\'s rules', () => {
  const names = suggestNames(blockOf(CAROUSEL), CAROUSEL_HINTS, { rules: CAROUSEL_RULES, codeNoun: 'Panel' });
  assert.equal(names.multi, true);
  assert.equal(names.noun, 'Slide', 'the rules\' noun wins over the code\'s');
  assert.equal(names.rows.length, 1, 'one row names every item; settings rows are left out');
  assert.equal(names.rows[0].title, 'Every slide');
  assert.deepEqual(labelsOf(names.rows), [[['Slide image'], ['Slide eyebrow', 'Slide title', 'Slide description', 'Primary button']]], 'a rules sheet label never names a field');
  const text = names.rows[0].cells[1];
  assert.deepEqual(text.map((f) => f.auto), ['Eyebrow', 'Heading', 'Description', 'Primary button'], 'auto is what the panel shows unnamed');
  assert.deepEqual(text.map((f) => f.units), [1, 1, 2, 1], 'two paragraphs are one field');
  assert.equal(text[1].text, 'Instant Saver');
  const fromCode = suggestNames(blockOf(CAROUSEL), { knownKeys: new Set(['theme']) }, { codeNoun: 'Panel' });
  assert.equal(fromCode.rows[0].cells[1][1].label, 'Panel title', 'else the code\'s noun');
});

test('naming: other blocks are named row by row, and settings rows are ignored', () => {
  const names = suggestNames(blockOf(HERO), { knownKeys: new Set(['theme']) });
  assert.equal(names.multi, false);
  assert.deepEqual(labelsOf(names.rows), [[['Image', 'Heading', 'Description', 'Primary button']], 'option']);
  assert.equal(names.rows[0].title, 'Content');
  const table = fieldsTable(names.rows);
  assert.match(table, /<tr><td colspan="2"><p>Fields<\/p><\/td><\/tr>/, 'the header spans the widest row');
  assert.match(table, /<tr><td><p>IGNORE<\/p><\/td><td><p>IGNORE<\/p><\/td><\/tr>/);
});

test('naming: the fields table reads back as the names, and an empty name keeps the automatic one', async () => {
  const names = suggestNames(blockOf(CAROUSEL), CAROUSEL_HINTS, { rules: CAROUSEL_RULES });
  names.rows[0].cells[1][0].label = '  ';
  names.rows[0].cells[1][1].label = 'Account <name>';
  const table = fieldsTable(names.rows);
  assert.match(table, /<p>Slide description<\/p><p>Slide description<\/p>/, 'one paragraph per element');
  assert.match(table, /Account &lt;name&gt;/);
  const page = withFieldsTable(null, {
    name: 'carousel', title: 'Carousel', table, exampleHtml: exampleFromBlock(blockOf(CAROUSEL), 'https://main--s--o.aem.page/savings'),
  }, DOMParser);
  const lib = await libraryBlock([{ name: 'Carousel', path: 'https://content.da.live/o/s/library/blocks/carousel' }], 'carousel', async () => new Response(page.html), { Parser: DOMParser, hints: CAROUSEL_HINTS });
  assert.deepEqual(exampleFieldsFor(lib.examples, ['media-left']).map((f) => f.label), ['Slide image', '', 'Account <name>', 'Slide description', 'Primary button']);
  assert.deepEqual(lib.variants, [], 'the example is the default one, not a new variant');
});

test('naming: once named, the names are shown as they are, with where each comes from', async () => {
  const names = suggestNames(blockOf(CAROUSEL), CAROUSEL_HINTS, { rules: CAROUSEL_RULES });
  assert.equal(names.named, false);
  names.rows[0].cells[1][0].label = '';
  names.rows[0].cells[1][1].label = 'Title';
  const page = withFieldsTable(null, {
    name: 'carousel', title: 'Carousel', table: fieldsTable(names.rows), exampleHtml: exampleFromBlock(blockOf(CAROUSEL), 'https://main--s--o.aem.page/savings'),
  }, DOMParser);
  const lib = await libraryBlock([{ name: 'Carousel', path: 'https://content.da.live/o/s/library/blocks/carousel' }], 'carousel', async () => new Response(page.html), { Parser: DOMParser, hints: CAROUSEL_HINTS });
  const schema = exampleFieldsFor(lib.examples, ['media-left']);
  const hints = { ...CAROUSEL_HINTS, schema };
  const again = suggestNames(blockOf(CAROUSEL), hints, { rules: CAROUSEL_RULES });
  assert.equal(again.named, true);
  assert.deepEqual(
    labelsOf(again.rows),
    [[['Slide image'], ['', 'Title', 'Slide description', 'Primary button']]],
    'not rewritten to "Slide title"; unnamed stays empty',
  );
  const text = again.rows[0].cells[1];
  assert.deepEqual(text.map((f) => f.source), ['auto', 'library', 'library', 'library']);
  assert.deepEqual(text.map((f) => f.shown), ['Eyebrow', 'Title', 'Slide description', 'Primary button']);
  assert.equal(text[0].auto, 'Eyebrow', 'an empty name shows the automatic one');
  assert.equal(namesKey(again.rows), namesKey(names.rows), 'nothing changed');

  const sheet = suggestNames(blockOf(CAROUSEL), { ...CAROUSEL_HINTS, schema: [{ c: 1, type: 'heading', label: 'Headline' }] }, { rules: CAROUSEL_RULES });
  const heading = sheet.rows[0].cells[1][1];
  assert.deepEqual([heading.label, heading.source, heading.locked], ['Headline', 'sheet', true]);
  assert.equal(sheet.rows[0].cells[0][0].source, 'auto');
});

test('naming: limits are saved as a field-rules table beside the names, and read back', async () => {
  const names = suggestNames(blockOf(CAROUSEL), CAROUSEL_HINTS, { rules: CAROUSEL_RULES });
  const [kicker, title, description] = names.rows[0].cells[1];
  assert.deepEqual([description.max, description.maxDefault], ['', 160], 'the default comes from the rules sheet');
  assert.equal(fieldRulesTable(names.rows), '', 'no limits, no table');
  const before = namesKey(names.rows);
  Object.assign(title, { max: '40', required: true, hint: 'Say <what> it is' });
  Object.assign(kicker, { label: '', hint: 'One or two words' });
  assert.notEqual(namesKey(names.rows), before, 'a limit is a change');
  const table = fieldRulesTable(names.rows);
  assert.match(table, /<td><p>Slide title<\/p><\/td><td><p>40<\/p><\/td><td><p>yes<\/p><\/td><td><p>Say &lt;what&gt; it is<\/p><\/td>/);
  assert.match(table, /<td><p>Eyebrow<\/p><\/td><td><p><\/p><\/td>/, 'an unnamed field by its automatic name');

  const opts = {
    name: 'carousel', title: 'Carousel', rows: names.rows, pageUrl: 'https://content.da.live/o/s/library/blocks/carousel', indexUrl: 'https://content.da.live/o/s/library/blocks.json', exampleHtml: exampleFromBlock(blockOf(CAROUSEL), 'https://main--s--o.aem.page/savings'),
  };
  const plan = planNames(null, null, opts, DOMParser);
  assert.equal(plan.rulesChange, 'Add the field limits to the Carousel example');
  assert.ok(plan.changes.includes(plan.rulesChange));
  const read = async (html) => libraryBlock([{ name: 'Carousel', path: opts.pageUrl }], 'carousel', async () => new Response(html), { Parser: DOMParser, hints: CAROUSEL_HINTS });
  const lib = await read(plan.page.html);
  const fieldRules = exampleRulesFor(lib.examples, ['media-left']);
  assert.deepEqual(fieldRules.map((r) => [r.field, r.max, r.required, r.hint]), [
    ['eyebrow', 0, false, 'One or two words'], ['slide-title', 40, true, 'Say <what> it is'],
  ]);
  const hints = { ...CAROUSEL_HINTS, schema: exampleFieldsFor(lib.examples, ['media-left']) };
  const again = suggestNames(blockOf(CAROUSEL), hints, { rules: CAROUSEL_RULES, fieldRules });
  const text = again.rows[0].cells[1];
  assert.deepEqual([text[1].max, text[1].required, text[1].hint], [40, true, 'Say <what> it is'], 'the form opens with them');
  assert.equal(text[0].hint, 'One or two words');
  assert.equal(namesKey(again.rows), namesKey(names.rows), 'nothing changed');

  const same = planNames(plan.page.html, null, { ...opts, rows: again.rows }, DOMParser);
  assert.deepEqual([same.rulesChange, same.hadRules], ['', true], 'saving the same limits is not a change');
  text[1].max = '50';
  assert.equal(limitsChange(again.rows, true, 'Carousel'), 'Replace the field limits of the Carousel example');
  text.forEach((field) => Object.assign(field, { max: '', required: false, hint: '' }));
  const cleared = planNames(plan.page.html, null, { ...opts, rows: again.rows }, DOMParser);
  assert.equal(cleared.rulesChange, 'Remove the field limits from the Carousel example');
  assert.doesNotMatch(cleared.page.html, /field-rules/);
  assert.match(cleared.page.html, /<p>fields<\/p>/, 'the names stay');
  assert.equal(limitsChange(again.rows, false, 'Carousel'), '');
});

test('naming: the table goes in the example\'s library-metadata, adding what is missing', () => {
  const opts = {
    name: 'cards', title: 'Cards', variants: ['icons'], table: '<table><tr><td>Fields</td></tr></table>', exampleHtml: '<div class="cards"><div><div>New</div></div></div>',
  };
  const page = (body) => `<body><header></header><main>${body}</main><footer></footer></body>`;
  const read = (html) => {
    const doc = parseHtml(html, DOMParser);
    const el = pickExample(doc, 'cards', ['icons']);
    const meta = [...doc.querySelectorAll('.library-metadata')];
    return {
      doc, el, meta, fields: doc.querySelectorAll('.library-metadata table').length,
    };
  };

  const created = withFieldsTable('', opts, DOMParser);
  assert.equal(created.action, 'create-page');
  assert.match(created.html, /^<body><header><\/header><main><div><h2>Cards<\/h2><div class="cards">/);
  assert.equal(read(created.html).el.nextElementSibling.className, 'library-metadata');

  const other = withFieldsTable(page('<div><div class="hero"><div><div>Hi</div></div></div></div>'), opts, DOMParser);
  assert.equal(other.action, 'add-example');
  assert.equal(blockElements(parseHtml(other.html, DOMParser)).length, 2);

  const bare = withFieldsTable(page('<div><div class="cards"><div><div>A</div></div></div><div class="cards icons"><div><div>B</div></div></div></div>'), opts, DOMParser);
  assert.equal(bare.action, 'add-fields');
  const bareDoc = read(bare.html);
  assert.equal(bareDoc.el.textContent, 'B', 'the example with the same variants');
  assert.equal(bareDoc.el.nextElementSibling.className, 'library-metadata');

  const described = withFieldsTable(page('<div><div class="cards"><div><div>A</div></div></div><div class="library-metadata"><div><div><p>description</p></div><div><p>Cards.</p></div></div></div></div>'), opts, DOMParser);
  assert.equal(described.action, 'add-fields');
  assert.deepEqual([...read(described.html).meta[0].children].map((row) => row.children[0].textContent), ['description', 'fields']);

  const named = withFieldsTable(described.html, { ...opts, table: '<table><tr><td>Fields</td></tr><tr><td>X</td></tr></table>' }, DOMParser);
  assert.equal(named.action, 'replace-fields');
  assert.equal(read(named.html).fields, 1);
  assert.match(named.html, /<td>X<\/td>/);
  assert.throws(() => withFieldsTable('<p>Not a page</p>', opts, DOMParser), /not a Document Authoring page/);
});

test('naming: the example copies the block without bookkeeping, variants or relative images', () => {
  const el = blockOf('<div class="cards icons" data-ew="1"><div data-ew-row="0"><div><picture><source srcset="./media_1.webp"><img src="./media_1.jpg" alt=""></picture></div></div></div>');
  const html = exampleFromBlock(el, 'https://main--s--o.aem.page/offers/winter');
  assert.equal(html, '<div class="cards"><div><div><picture><img src="https://main--s--o.aem.page/offers/media_1.jpg" alt=""></picture></div></div></div>');
  assert.deepEqual(classesOf(el), ['cards', 'icons'], 'the page block is unchanged');
});

test('naming: the library list gets the block, and repeating blocks an editor row', () => {
  const live = {
    blocks: {
      total: 1, limit: 1, offset: 0, data: [{ name: 'Cards', path: 'https://content.da.live/o/s/library/blocks/cards' }],
    },
    options: {
      total: 0, limit: 0, offset: 0, data: [],
    },
    editor: {
      total: 1, limit: 1, offset: 0, data: [{ block: 'cards', property: 'multi' }],
    },
    ':names': ['blocks', 'options', 'editor'],
    ':version': 3,
    ':type': 'multi-sheet',
  };
  const hero = withLibraryRows(live, { name: 'hero', title: 'Hero', path: 'https://content.da.live/o/s/library/blocks/hero' });
  assert.deepEqual([hero.addedBlock, hero.addedMulti], [true, false]);
  assert.deepEqual(hero.json.blocks.data[1], { name: 'Hero', path: 'https://content.da.live/o/s/library/blocks/hero' });
  assert.deepEqual([hero.json.blocks.total, hero.json.blocks.limit, hero.json[':names']], [2, 2, ['blocks', 'options', 'editor']]);
  assert.equal(live.blocks.data.length, 1, 'the input is not changed');

  const carousel = withLibraryRows(live, {
    name: 'carousel', title: 'Carousel', path: '/x', multi: true,
  });
  assert.deepEqual(carousel.json.editor.data[1], { block: 'carousel', property: 'multi' });
  const cards = withLibraryRows(live, {
    name: 'card', title: 'Card', path: '/x', multi: true,
  });
  assert.deepEqual([cards.addedBlock, cards.addedMulti], [false, false], 'already listed and marked');

  const single = {
    total: 1, limit: 1, offset: 0, data: [{ Name: 'Cards', Path: '/cards' }], ':type': 'sheet',
  };
  const plain = withLibraryRows(single, { name: 'hero', title: 'Hero', path: '/hero' });
  assert.deepEqual(plain.json, {
    total: 2, limit: 2, offset: 0, data: [{ Name: 'Cards', Path: '/cards' }, { Name: 'Hero', Path: '/hero' }], ':type': 'sheet',
  }, 'the same columns');
  const upgraded = withLibraryRows(single, {
    name: 'faq', title: 'FAQ', path: '/faq', multi: true,
  }).json;
  assert.deepEqual(upgraded[':names'], ['data', 'editor']);
  assert.deepEqual([upgraded[':type'], upgraded[':version'], upgraded.data.data.length], ['multi-sheet', 3, 2]);
  assert.equal(upgraded.data[':type'], undefined);
  assert.deepEqual(withLibraryRows(null, { name: 'hero', title: 'Hero', path: '/hero' }).json.data, [{ name: 'Hero', path: '/hero' }]);
});

test('naming: library URLs map to their DA source, and a new page sits beside the others', () => {
  assert.deepEqual(daSource('https://content.da.live/o/s/library/blocks/hero'), { url: 'https://admin.da.live/source/o/s/library/blocks/hero.html', path: '/library/blocks/hero' });
  assert.deepEqual(daSource('https://main--s--o.aem.page/docs/library/blocks/hero.plain.html'), { url: 'https://admin.da.live/source/o/s/docs/library/blocks/hero.html', path: '/docs/library/blocks/hero' });
  assert.equal(daSource('https://feat-x--s--o.aem.live/docs/library/blocks.json').url, 'https://admin.da.live/source/o/s/docs/library/blocks.json');
  assert.equal(daSource('https://content.da.live/o/s/docs/').url, 'https://admin.da.live/source/o/s/docs/index.html');
  assert.equal(daSource('demo:/docs/library/blocks/hero'), null);
  assert.equal(daSource('https://example.com/docs/x'), null);
  assert.equal(daEditUrl('https://main--s--o.aem.page/docs/library/blocks/hero'), 'https://da.live/edit#/o/s/docs/library/blocks/hero');
  assert.equal(daEditUrl('https://content.da.live/o/s/library/blocks.json'), '', 'sheets do not open in the editor');

  const rows = [{ name: 'Cards', path: 'https://content.da.live/o/s/library/blocks/cards' }];
  const index = 'https://content.da.live/o/s/library/blocks.json';
  assert.deepEqual(libraryPageFor(rows, index, 'card'), { url: rows[0].path, listed: true });
  assert.deepEqual(libraryPageFor(rows, index, 'hero'), { url: 'https://content.da.live/o/s/library/blocks/hero', listed: false });
  assert.deepEqual(libraryPageFor([], 'https://main--s--o.aem.live/docs/library/blocks.json', 'Hero Banner'), { url: 'https://main--s--o.aem.live/docs/library/blocks/hero-banner', listed: false });
});

const fakeStore = (files) => {
  const writes = [];
  return {
    writes,
    read: async (url) => (url in files ? files[url] : null),
    write: async (url, body, type) => {
      writes.push({ url, body, type });
      files[url] = body;
    },
  };
};

test('naming: saving writes the page, then the list only if it changed', async () => {
  const names = suggestNames(blockOf(HERO), { knownKeys: new Set(['theme']) });
  const pageUrl = 'https://content.da.live/o/s/library/blocks/hero';
  const indexUrl = 'https://content.da.live/o/s/library/blocks.json';
  const opts = {
    name: 'hero', title: 'Hero', rows: names.rows, multi: false, exampleHtml: exampleFromBlock(blockOf(HERO), pageUrl), pageUrl, indexUrl,
  };
  const plan = planNames(null, null, opts, DOMParser);
  assert.deepEqual(plan.changes, ['Create /library/blocks/hero with an example Hero block and its field names', 'List Hero in the block library (/library/blocks)']);
  assert.equal(plan.notes.length, 2, 'no preview needed for a DA library');
  assert.match(plan.notes[0], /every author/);
  assert.equal(planNames(null, null, { ...opts, pageUrl: 'https://main--s--o.aem.page/docs/hero' }, DOMParser).notes.length, 3);

  const store = fakeStore({ [indexUrl]: JSON.stringify({ data: [{ name: 'Cards', path: '/cards' }] }) });
  const saved = await saveNames(store, opts, DOMParser);
  assert.equal(saved.action, 'create-page');
  assert.deepEqual(store.writes.map((w) => [w.url, w.type]), [[pageUrl, 'text/html'], [indexUrl, 'application/json']]);
  assert.deepEqual(JSON.parse(store.writes[1].body).data.map((row) => row.name), ['Cards', 'Hero']);

  const again = fakeStore({ [pageUrl]: store.writes[0].body, [indexUrl]: store.writes[1].body });
  assert.equal((await saveNames(again, opts, DOMParser)).action, 'replace-fields');
  assert.deepEqual(again.writes.map((w) => w.url), [pageUrl], 'the list already has the block');

  const broken = fakeStore({ [indexUrl]: '{oops' });
  await assert.rejects(saveNames(broken, opts, DOMParser), /not valid JSON/);
  assert.equal(broken.writes.length, 0);
});
