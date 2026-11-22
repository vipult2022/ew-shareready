import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import {
  parseHtml, blockElements, signature, outline, cleanBlock,
} from '../lib/live.js';
import {
  parseBlock, layout, applyOp, applyOps, buildBlock, pushOp, items, options, findField,
  exampleFields,
} from '../lib/model.js';
import {
  cleanFlow, cleanInline, safeUrl, textToHtml,
} from '../lib/sanitize.js';

const SCRIPT_URL = ['java', 'script:alert(1)'].join('');

const CAROUSEL = `<div class="carousel media-left" data-block-index="5">
  <div><div><picture><source srcset="./media_1.jpg?width=750"><img src="./media_1.jpg?width=750" alt="Couple with keys" width="1600" height="900" data-image-index="7"></picture></div><div><p data-prose-index="9">:award:</p><p>Award winning</p><h3 data-prose-index="12">Savings that grow</h3><p>Earn 4.25% APY.</p><p><strong><a href="/savings">Open an account</a></strong></p></div></div>
  <div><div><picture><img src="./media_2.jpg" alt="Keys"></picture></div><div><p>:book:</p><p>New</p><h3>Home loans</h3><p>Low rates.</p></div></div>
  <div><div><picture><img src="./media_3.jpg" alt=""></picture></div><div><p>:lock:</p><p>Secure</p><h3>Card controls</h3><p>Freeze in a tap.</p><p><em><a href="https://main--site--org.aem.page/cards">See cards</a></em></p></div></div>
  <div><div>theme</div><div>Surface/light - Light</div></div>
</div>`;

const page = (blocks) => parseHtml(`<body><main><div><h1>Page</h1>${blocks}<div class="metadata"><div><div>title</div><div>x</div></div></div></div></main></body>`, DOMParser);
const firstBlock = (html, hints) => {
  const doc = page(html);
  return { doc, model: parseBlock(blockElements(doc)[0], hints) };
};
const sig = (html) => signature(html, DOMParser);

test('live: finds blocks, skips metadata and ignores EW instrumentation', () => {
  const doc = page(`${CAROUSEL}<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>`);
  const blocks = blockElements(doc);
  assert.equal(blocks.length, 1);
  assert.deepEqual(outline(doc).map((b) => [b.name, b.variants]), [['carousel', ['media-left']]]);
  assert.equal(cleanBlock(blocks[0]).querySelectorAll('[data-prose-index], [data-image-index]').length, 0);
  assert.equal(sig(blocks[0].outerHTML), sig(blocks[0].outerHTML.replaceAll(' data-prose-index="9"', '')));
});

test('model: a carousel with a trailing theme row has items and one block option', () => {
  const { model } = firstBlock(CAROUSEL);
  assert.equal(model.name, 'carousel');
  assert.deepEqual(model.variants, ['media-left']);
  assert.equal(model.mode, 'items');
  assert.equal(model.noun, 'Slide');
  assert.equal(items(model).length, 3);
  assert.deepEqual(options(model).map((r) => [r.option.key, r.option.value]), [['theme', 'Surface/light - Light']]);
  const types = items(model)[0].cells.map((cell) => cell.fields.map((f) => f.type));
  assert.deepEqual(types, [['image'], ['icon', 'text', 'heading', 'text', 'button']]);
  const button = findField(model, 'r0.1.4').field;
  assert.deepEqual([button.text, button.href, button.style], ['Open an account', '/savings', 'primary']);
  assert.equal(findField(model, 'r2.1.4').field.style, 'secondary');
});

test('layout: labels fields and shows a missing button as an empty slot', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  const view = layout(model, doc);
  assert.equal(view.options.length, 1);
  assert.equal(view.groups.length, 3);
  const [first, second] = view.groups;
  assert.deepEqual([first.title, first.subtitle], ['Slide 1', 'Savings that grow']);
  assert.deepEqual(first.cells[1].map((s) => s.label), ['Icon', 'Eyebrow', 'Heading', 'Description', 'Primary button']);
  const missing = second.cells[1].find((s) => !s.field);
  assert.equal(missing.type, 'button');
  assert.equal(missing.at, 4);
});

test('write-back: an unedited block is unchanged and one edit only touches its field', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  const original = cleanBlock(blockElements(doc)[0]).outerHTML;
  assert.equal(sig(buildBlock(model, doc)), sig(original));
  applyOp(model, { t: 'set', id: 'r1.1.2', props: { value: 'Home loans <em>made simple</em>' } }, doc);
  const out = buildBlock(model, doc);
  assert.match(out, /<h3>Home loans <em>made simple<\/em><\/h3>/);
  assert.match(out, /<source srcset="\.\/media_1\.jpg\?width=750">/);
  assert.match(out, /<div><div>theme<\/div><div>Surface\/light - Light<\/div><\/div><\/div>$/);
  assert.equal(sig(out).replace('Home loans <em>made simple</em>', 'Home loans'), sig(original));
});

test('items: add, move and delete never move the block options row', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  applyOp(model, {
    t: 'add-item', from: 'r1', id: 'n1', blank: true,
  }, doc);
  assert.deepEqual(model.rows.map((r) => r.id), ['r0', 'r1', 'r2', 'n1', 'r3']);
  const added = items(model)[3];
  assert.equal(added.cells[1].fields[2].value, 'Heading');
  assert.equal(added.cells[0].fields[0].src, './media_2.jpg');
  assert.ok(applyOp(model, { t: 'move-item', row: 'n1', by: -3 }, doc));
  assert.ok(!applyOp(model, { t: 'move-item', row: 'n1', by: -1 }, doc));
  assert.deepEqual(model.rows.map((r) => r.id), ['n1', 'r1', 'r2', 'r0', 'r3']);
  applyOps(model, ['n1', 'r1', 'r2'].map((row) => ({ t: 'delete-item', row })), doc);
  assert.ok(!applyOp(model, { t: 'delete-item', row: 'r0' }, doc), 'keeps the last item');
  assert.deepEqual(model.rows.map((r) => r.id), ['r0', 'r3']);
  assert.match(buildBlock(model, doc), /Savings that grow.*theme/s);
});

test('items: duplicating keeps content, adding a missing button fills the slot', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  applyOp(model, {
    t: 'add-item', from: 'r0', after: 'r0', id: 'n2',
  }, doc);
  assert.deepEqual(model.rows.map((r) => r.id), ['r0', 'n2', 'r1', 'r2', 'r3']);
  applyOp(model, {
    t: 'add-field', row: 'r1', c: 1, at: 4, type: 'button', sample: { style: 'primary' },
  }, doc);
  applyOp(model, { t: 'set', id: 'r1.1.4', props: { href: '/home-loans', text: 'Compare rates' } }, doc);
  const out = buildBlock(model, doc);
  assert.equal((out.match(/Savings that grow/g) || []).length, 2);
  assert.match(out, /<p>Low rates\.<\/p><p><strong><a href="\/home-loans">Compare rates<\/a><\/strong><\/p>/);
  const view = layout(model, doc);
  assert.ok(view.groups[2].cells[1].every((s) => s.field));
});

test('options: set, add and remove, written as plain two-cell rows', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  applyOp(model, { t: 'option', key: 'theme', value: 'surface-dark' }, doc);
  applyOp(model, {
    t: 'option', key: 'autoplay', keyText: 'autoplay', value: 'true',
  }, doc);
  let out = buildBlock(model, doc);
  assert.match(out, /<div><div>theme<\/div><div>surface-dark<\/div><\/div><div><div>autoplay<\/div><div>true<\/div><\/div><\/div>$/);
  applyOp(model, { t: 'remove-option', key: 'theme' }, doc);
  out = buildBlock(model, doc);
  assert.doesNotMatch(out, /theme/);
  assert.equal(options(model).length, 1);
});

test('variants: chips are written as classes after the block name', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  applyOp(model, { t: 'variants', list: ['media-left', 'Full Width', 'media-left'] }, doc);
  assert.match(buildBlock(model, doc), /^<div class="carousel media-left full-width">/);
  const ops = [];
  pushOp(ops, { t: 'set', id: 'a', props: { value: '1' } });
  pushOp(ops, { t: 'set', id: 'a', props: { level: 2 } });
  pushOp(ops, { t: 'variants', list: ['x'] });
  pushOp(ops, { t: 'variants', list: ['y'] });
  assert.deepEqual(ops, [{ t: 'set', id: 'a', props: { value: '1', level: 2 } }, { t: 'variants', list: ['y'] }]);
});

test('images: a new src replaces srcset and sizes, alt is kept in sync', () => {
  const { doc, model } = firstBlock(CAROUSEL);
  applyOp(model, { t: 'set', id: 'r0.0.0', props: { src: 'https://content.da.live/o/s/.page/new.jpg', alt: 'A new home' } }, doc);
  applyOp(model, { t: 'set', id: 'r2.0.0', props: { alt: 'Phone showing card controls' } }, doc);
  const out = buildBlock(model, doc);
  assert.match(out, /<source srcset="https:\/\/content\.da\.live\/o\/s\/\.page\/new\.jpg"><img src="https:\/\/content\.da\.live\/o\/s\/\.page\/new\.jpg" alt="A new home">/);
  assert.match(out, /<img src="\.\/media_3\.jpg" alt="Phone showing card controls">/);
});

test('buttons and icons: styles, inline cells and icon spans', () => {
  const { doc, model } = firstBlock(`<div class="cards"><div>
    <div><span class="icon icon-shield"></span></div>
    <div><strong><em><a href="/a">Accent</a></em></strong></div>
    <div><a href="/b">Plain</a></div>
    <div>Just inline text</div>
  </div></div>`);
  const [icon, accent, plain, text] = items(model)[0].cells.map((cell) => cell.fields[0]);
  assert.deepEqual([icon.type, icon.name, icon.format], ['icon', 'shield', 'span']);
  assert.deepEqual([accent.type, accent.style], ['button', 'accent']);
  assert.deepEqual([plain.type, plain.style], ['button', 'link']);
  assert.deepEqual([text.type, text.inline], ['text', true]);
  applyOp(model, { t: 'set', id: plain.id, props: { style: 'secondary' } }, doc);
  applyOp(model, { t: 'set', id: text.id, props: { value: '<p>New <strong>inline</strong> text</p>' } }, doc);
  applyOp(model, { t: 'set', id: icon.id, props: { name: 'lock' } }, doc);
  const out = buildBlock(model, doc);
  assert.match(out, /<div><span class="icon icon-lock"><\/span><\/div>/);
  assert.match(out, /<div><em><a href="\/b">Plain<\/a><\/em><\/div>/);
  assert.match(out, /<div>New <strong>inline<\/strong> text<\/div>/);
});

test('groups: a hero is one Content group; a two-column block shows columns', () => {
  const { doc, model } = firstBlock('<div class="hero"><div><div><picture><img src="./h.jpg" alt="x"></picture><h1>Bank better</h1><p>Intro.</p><p>More.</p><ul><li>One</li></ul><p><strong><a href="/go">Go</a></strong></p></div></div></div>');
  assert.equal(model.mode, 'groups');
  const view = layout(model, doc);
  assert.equal(view.groups[0].title, 'Content');
  assert.deepEqual(view.groups[0].cells[0].map((s) => s.label), ['Image', 'Heading', 'Description', 'Primary button']);
  assert.match(view.groups[0].cells[0][2].field.value, /<p>Intro\.<\/p><p>More\.<\/p><ul><li>One<\/li><\/ul>/);
  const cols = firstBlock('<div class="columns"><div><div><h2>Left</h2><p>a</p></div><div><picture><img src="./c.jpg" alt="c"></picture></div></div></div>');
  assert.deepEqual(layout(cols.model, cols.doc).groups.map((g) => g.title), ['Column 1', 'Column 2: image']);
});

test('option detection: leading rows, known keys and rules overrides', () => {
  const cards = `<div class="cards"><div><div>autoplay</div><div>true</div></div>
    <div><div><h3>One</h3><p>a</p></div></div><div><div><h3>Two</h3><p>b</p></div></div>
    <div><div>Read more</div><div>Our guides</div></div></div>`;
  const plain = firstBlock(cards).model;
  assert.deepEqual(options(plain).map((r) => r.option.key), ['autoplay']);
  assert.equal(items(plain).length, 3, 'a capitalised two-word row stays an item');
  const known = firstBlock(cards, { knownKeys: new Set(['read-more']) }).model;
  assert.deepEqual(options(known).map((r) => r.option.key), ['autoplay', 'read-more']);
  const forcedItems = firstBlock(cards, { items: 'all' }).model;
  assert.equal(options(forcedItems).length, 0);
  const facts = firstBlock('<div class="facts"><div><div>Founded</div><div>1921</div></div><div><div>Branches</div><div>140</div></div></div>').model;
  assert.equal(options(facts).length, 0, 'a block of capitalised label rows is content');
});

test('sanitize: cleans Word and Google Docs paste and unsafe links', () => {
  const doc = parseHtml('<body></body>', DOMParser);
  const word = '<p class="MsoListParagraph" style="mso-list:l0 level1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>First<o:p></o:p></p><p class=MsoNormal><b>Bold</b> and <span style="font-style:italic">italic</span></p>';
  assert.equal(cleanFlow(word, doc), '<p>First</p><p><strong>Bold</strong> and <em>italic</em></p>');
  const gdocs = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Rate</span> <span>4.25%</span></p><ul><li><p>One</p></li></ul></b>';
  assert.equal(cleanFlow(gdocs, doc), '<p><strong>Rate</strong> 4.25%</p><ul><li>One</li></ul>');
  assert.equal(cleanFlow(`<p><a href="${SCRIPT_URL}">x</a><img src=x onerror=alert(1)><script>bad()</script></p>`, doc), '<p>x</p>');
  assert.equal(cleanInline('<h2>Head<br></h2>', doc), 'Head');
  assert.equal(safeUrl(' JaVa\nScript:alert(1)'), '');
  assert.equal(safeUrl('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeUrl('/rates?x=1'), '/rates?x=1');
  assert.equal(textToHtml('One\nline <b>\n\nTwo'), '<p>One<br>line &lt;b&gt;</p><p>Two</p>');
});

test('config: image options and fields-sheet slots for a block nobody coded for', () => {
  const html = `<div class="promo">
    <div><div><picture><img src="./a.jpg" alt="A"></picture></div><div><h3>One</h3><p>a</p></div></div>
    <div><div><picture><img src="./b.jpg" alt="B"></picture></div><div><h3>Two</h3></div></div>
    <div><div>background</div><div><picture><img src="./bg.jpg" alt="Sky"></picture></div></div>
  </div>`;
  const schema = [
    { c: 1, type: 'heading', label: 'Promo title' },
    { c: 1, type: 'text', label: 'Promo text' },
    { c: 2, type: 'image', label: 'Promo background' },
  ];
  const hints = {
    knownKeys: new Set(['background']), imageKeys: new Set(['background']), noun: 'Promo', schema,
  };
  const { doc, model } = firstBlock(html, hints);
  const [bg] = options(model).map((row) => row.option);
  assert.deepEqual([bg.key, bg.image, bg.value, bg.alt], ['background', true, './bg.jpg', 'Sky']);
  assert.equal(items(model).length, 2);

  const view = layout(model, doc);
  const second = view.groups[1].cells;
  assert.equal(second.length, 3, 'the fields sheet adds a third column');
  assert.deepEqual(second[1].map((s) => [s.label, !!s.field]), [['Promo title', true], ['Promo text', false]]);
  assert.deepEqual(second[2].map((s) => [s.type, s.label, !!s.field]), [['image', 'Promo background', false]]);

  assert.doesNotMatch(buildBlock(model, doc), /Promo|<h3><\/h3>/, 'schema slots add nothing until used');
  applyOp(model, {
    t: 'option', key: 'background', keyText: 'background', image: { src: './new.jpg', alt: 'Sea' },
  }, doc);
  const out = buildBlock(model, doc);
  assert.match(out, /<div><div>background<\/div><div><picture>.*<img[^>]*src="\.\/new\.jpg"[^>]*alt="Sea"|<div><div>background<\/div><div><picture>.*<img[^>]*alt="Sea"[^>]*src="\.\/new\.jpg"/);
  assert.doesNotMatch(out, /bg\.jpg/);
  const again = firstBlock(out, hints).model;
  assert.equal(options(again)[0].option.value, './new.jpg');
});

test('config: a block with only a fields sheet stays a list of items', () => {
  const schema = [
    { c: 0, type: 'heading', label: 'Promo title' },
    { c: 1, type: 'image', label: 'Promo background' },
  ];
  const one = firstBlock('<div class="promo"><div><div><h3>One</h3></div></div></div>', { schema });
  assert.equal(one.model.mode, 'items', 'one item');
  const mixed = firstBlock(`<div class="promo">
    <div><div><h3>One</h3></div><div><picture><img src="./a.jpg" alt=""></picture></div></div>
    <div><div><h3>Two</h3><p>Text</p></div></div>
  </div>`, { schema });
  assert.equal(mixed.model.mode, 'items', 'items with different cell counts');
  const second = layout(mixed.model, mixed.doc).groups[1].cells;
  assert.deepEqual(second[1].map((s) => [s.label, !!s.field]), [['Promo background', false]]);
});

test('names: a library example names fields; short first lines default to Title', () => {
  const labelsOf = (model, doc) => layout(model, doc).groups
    .map((g) => g.cells.map((c) => c.map((s) => s.label)));
  const acc = firstBlock(`<div class="accordion">
    <div><div>Can I open online?</div><div><p>Yes, in minutes.</p></div></div>
    <div><div>Any fees?</div><div><p>No monthly fees.</p><p>None at all.</p></div></div></div>`);
  assert.deepEqual(labelsOf(acc.model, acc.doc)[1], [['Title'], ['Description']], 'zero config');
  const accEl = blockElements(acc.doc)[0];
  const qa = exampleFields(accEl, [[['Question'], ['Answer']]]);
  assert.deepEqual(qa.map((d) => [d.c, d.type, d.label, d.labelOnly, d.r]), [[0, 'text', 'Question', true, undefined], [1, 'text', 'Answer', true, undefined]]);
  const pic = {
    c: 2, type: 'image', label: 'Pic', labelOnly: true,
  };
  const named = parseBlock(accEl, { schema: [...qa, pic] });
  assert.deepEqual(labelsOf(named, acc.doc), [[['Question'], ['Answer']], [['Question'], ['Answer']]], 'one label row names every item; names add no slots');
  const perPanel = exampleFields(accEl, [[['Question'], ['Answer']], [['Question'], ['Answer']]]);
  const longer = firstBlock(`<div class="accordion">${'<div><div>Q?</div><div><p>A.</p></div></div>'.repeat(3)}</div>`);
  const longerModel = parseBlock(blockElements(longer.doc)[0], { schema: perPanel });
  assert.deepEqual(labelsOf(longerModel, longer.doc)[2], [['Question'], ['Answer']], 'a row per example panel still names a third panel');
  const faq = firstBlock('<div class="help"><div><div><h3>Q?</h3><p>A.</p></div></div></div>');
  const faqEl = blockElements(faq.doc)[0];
  assert.equal(parseBlock(faqEl).mode, 'groups');
  assert.equal(parseBlock(faqEl, { multi: true }).mode, 'items', 'multi makes any block a list of items');
  const multiDefs = exampleFields(accEl, [[['Question'], ['Answer']], [['Other'], ['Row']]], { multi: true });
  assert.deepEqual(multiDefs.map((d) => [d.r, d.label]), [[undefined, 'Question'], [undefined, 'Answer']], 'multi: the first label row names every item');

  const hero = firstBlock('<div class="hero"><div><div><h1>Bank</h1><p>Intro.</p><p>More.</p><p><strong><a href="/go">Go</a></strong></p></div></div></div>');
  const heroEl = blockElements(hero.doc)[0];
  const merged = exampleFields(heroEl, [[['Headline', 'Lead', 'Detail', 'CTA']]]);
  assert.deepEqual(merged.map((d) => d.label), ['Headline', 'Lead & Detail', 'CTA'], 'merged paragraphs take their labels together');
  assert.equal(parseBlock(heroEl, { schema: merged }).mode, 'groups', 'names never change the mode');
  assert.deepEqual(labelsOf(parseBlock(heroEl, { schema: merged }), hero.doc), [[['Headline', 'Lead & Detail', 'CTA']]]);
  const ignored = parseBlock(heroEl, { schema: exampleFields(heroEl, [[['IGNORE', 'Lead', 'ignore']]]) });
  assert.deepEqual(labelsOf(ignored, hero.doc), [[['Heading', 'Lead', 'Primary button']]], 'IGNORE keeps the automatic name');
  assert.deepEqual(exampleFields(heroEl, [[['A', 'B']]]), [], 'labels that do not line up are skipped');

  const cols = firstBlock(`<div class="columns">
    <div><div><h2>Left</h2><p>a</p></div><div><picture><img src="./c.jpg" alt="c"></picture></div></div>
    <div><div><h3>Row 2</h3></div><div><p>x</p></div></div>
    <div><div>theme</div><div>dark</div></div></div>`, { knownKeys: new Set(['theme']) });
  const colsEl = blockElements(cols.doc)[0];
  const perRow = exampleFields(colsEl, [[['Title', 'Text'], ['Photo']], [['Sub'], ['Note']], [['IGNORE'], ['Color']]], { knownKeys: new Set(['theme']) });
  assert.deepEqual(perRow.map((d) => [d.r, d.c, d.label]), [
    [0, 0, 'Title'], [0, 0, 'Text'], [0, 1, 'Photo'], [1, 0, 'Sub'], [1, 1, 'Note'],
    [undefined, 0, 'Title'], [undefined, 0, 'Text'], [undefined, 1, 'Photo'],
  ], 'one label row per row, option rows skipped; the first item also names later items');
  const rows = labelsOf(parseBlock(colsEl, { knownKeys: new Set(['theme']), schema: perRow }), cols.doc);
  assert.deepEqual([rows[0][0], rows[0][1][1], rows[1][0][0], rows[1][1][0]], [['Title', 'Text'], 'Photo', 'Sub', 'Note'], 'each row keeps its own names');
});
