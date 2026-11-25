import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { parseHtml, blockElements } from '../lib/live.js';
import { parseBlock, layout } from '../lib/model.js';
import {
  checkBlock, counter, linkIssue, altIssue, imageIssue, limitFor, healthText,
} from '../lib/check.js';
import {
  parseRules, blockRules, parseLibraryOptions, parseValues, blocksLibraryUrls, makeFetcher,
  loadSiteSettings, fieldRule, sheetRows, libraryVariants, parseOptionDefs, parseItemFields,
  libraryBlock, exampleFieldsFor, withLibraryFields, parseMultiBlocks, exampleRulesFor,
  namingEditors, canEditNames, imsEmail, IMS_PROFILE,
} from '../lib/rules.js';
import { fieldPrompt, altPrompt, briefPrompt } from '../lib/ai.js';

const CARDS = `<main><div><div class="cards">
  <div><div><picture><img src="./media_1.jpg" alt="IMG_2041.jpg"></picture></div><div><h3>Savings that grow with you, every single month, with no fees and no minimum balance required</h3><p><a href="#">Open</a></p></div></div>
  <div><div><picture><img src="./media_2.jpg" alt=""></picture></div><div><h3></h3><p><a href="https://main--site--org.aem.page/loans">Loans</a></p><p>See <a href="http://localhost:3000/x">this</a>.</p></div></div>
  <div><div>theme</div><div>neon</div></div>
</div></div></main>`;

const RULES_SHEET = [
  {
    block: 'cards', field: 'theme', label: 'Theme', values: 'Light surface=surface-light|Dark surface=surface-dark', required: 'yes',
  },
  { block: 'cards', field: 'heading', max: '50' },
  { block: '', field: 'description', required: 'yes' },
  { block: 'cards', field: 'items', label: 'Offer' },
  { block: 'carousel', field: 'options', values: 'theme, autoplay' },
];

const setup = (rulesRows = RULES_SHEET) => {
  const doc = parseHtml(CARDS, DOMParser);
  const rules = blockRules(parseRules(rulesRows), 'cards');
  const model = parseBlock(blockElements(doc)[0], {
    knownKeys: rules.knownKeys, options: rules.options, items: rules.items, noun: rules.noun,
  });
  return {
    doc, rules, model, view: layout(model, doc),
  };
};

test('rules: block rows override "all" rows and set nouns, values and options', () => {
  const { rules, model } = setup();
  assert.equal(model.noun, 'Offer');
  assert.deepEqual(rules.values.get('theme').map((v) => v.value), ['surface-light', 'surface-dark']);
  assert.ok(rules.knownKeys.has('theme'));
  assert.equal(fieldRule(rules, 'Heading', 'heading').max, 50);
  assert.equal(fieldRule(rules, 'Description 2', 'text').required, true);
  assert.deepEqual(blockRules(parseRules(RULES_SHEET), 'Carousel').options, ['theme', 'autoplay']);
  assert.deepEqual(parseValues('Light, Dark'), [{ title: 'Light', value: 'Light' }, { title: 'Dark', value: 'Dark' }]);
});

test('rules: reads Block Inspector options sheets and library URLs', () => {
  const lib = parseLibraryOptions([
    { blocks: 'all', key: 'Spacing', values: 'Small=s|Large=l' },
    { blocks: 'Cards, carousel', key: 'theme', values: 'Light=surface-light' },
  ]);
  assert.deepEqual([...lib.get('cards').keys()].sort(), ['spacing', 'theme']);
  const rules = blockRules([], 'columns', lib);
  assert.deepEqual(rules.values.get('spacing').map((v) => v.value), ['s', 'l']);
  assert.deepEqual(blocksLibraryUrls([{ title: 'Blocks', path: '/docs/library/blocks.json, https://x.test/b.json' }], { org: 'o', site: 's', ref: 'local' }), [
    'https://main--s--o.aem.live/docs/library/blocks.json', 'https://x.test/b.json',
  ]);
  assert.deepEqual(sheetRows({ ':names': ['library'], library: { data: [{ a: 1 }] } }, 'library'), [{ a: 1 }]);
});

test('rules: the IMS token only goes to da.live and missing config is not an error', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push([url, opts.headers.Authorization]);
    if (url.endsWith('/config/o/s')) {
      return new Response(JSON.stringify({
        ':names': ['library', 'block-studio'],
        library: { data: [{ title: 'Blocks', path: 'https://content.da.live/o/s/library/blocks.json, /blocks.json' }] },
        'block-studio': { data: [{ block: 'cards', field: 'heading', max: '40' }] },
      }));
    }
    if (url.startsWith('https://content.da.live/') && !opts.headers.Authorization) {
      return new Response('', { status: 401 });
    }
    if (url.endsWith('/library/blocks/table')) {
      return new Response('<div><div class="table no-header"><div><div>a</div></div></div></div>');
    }
    if (url.endsWith('/blocks.json')) {
      return new Response(JSON.stringify({
        ':names': ['blocks', 'options'],
        blocks: { data: [{ name: 'Cards', path: 'https://main--s--o.aem.page/docs/cards' }] },
        options: { data: [{ blocks: 'cards', key: 'theme', values: 'Light=l' }] },
      }));
    }
    return new Response('', { status: 404 });
  };
  const fetcher = makeFetcher(() => 'TOKEN', fake);
  const settings = await loadSiteSettings(fetcher, { org: 'o', site: 's' });
  assert.equal(settings.rules[0].max, 40);
  assert.equal(settings.libraryOptions.get('cards').get('theme')[0].value, 'l');
  assert.deepEqual(settings.libraryBlocks.map((b) => b.name), ['Cards', 'Cards']);
  assert.equal(settings.libraryIndex, 'https://content.da.live/o/s/library/blocks.json', 'the first index is the one Block Studio adds to');
  const tables = [{ name: 'Table', path: 'https://content.da.live/o/s/library/blocks/table' }];
  assert.deepEqual((await libraryVariants(tables, 'table', fetcher, DOMParser)).map((v) => v.value), ['no-header']);
  assert.ok(calls.some(([url]) => url.startsWith('https://content.da.live/')));
  calls.forEach(([url, auth]) => assert.equal(auth, url.includes('.da.live/') ? 'Bearer TOKEN' : undefined, url));
  const empty = await loadSiteSettings(makeFetcher(() => '', async () => { throw new Error('offline'); }), { org: 'o', site: 's' });
  assert.deepEqual([empty.rules, empty.loaded], [[], false]);
});

test('checks: buttons, links, alt text, limits, empty fields and option values', () => {
  const { doc, rules, view } = setup();
  const issues = checkBlock(view, rules, doc);
  const text = issues.map((i) => `${i.level} ${i.where}: ${i.message}`);
  [
    'error Offer 1: Link has no link URL',
    'warn Offer 1: Heading is 92 characters (limit 50)',
    'warn Offer 1: Image has alt text that looks like a file name',
    'error Offer 2: Heading is empty',
    'warn Offer 2: Link links to a preview site (aem.page or aem.live). Use the live URL',
    'warn Offer 2: A link in description links to a local address (localhost)',
    'warn Offer 2: Image has no alt text',
    'warn Block options: theme “neon” is not one of the allowed values',
  ].forEach((line) => assert.ok(text.includes(line), `${line}\n${text.join('\n')}`));
  assert.ok(text.includes('error Offer 1: needs a description'), text.join('\n'));
  assert.equal(issues[0].level, 'error');
  assert.equal(issues.find((i) => i.message === 'Heading is empty').target, 'r1.1.0');
  assert.equal(healthText(issues), `${issues.length} issues`);
  assert.equal(healthText([]), 'No issues');
});

test('checks: required options and small helpers', () => {
  const doc = parseHtml('<main><div><div class="cards"><div><div><h3>One</h3><p>Hi</p></div></div><div><div><h3>Two</h3><p>Yo</p></div></div></div></div></main>', DOMParser);
  const rules = blockRules(parseRules(RULES_SHEET), 'cards');
  const model = parseBlock(blockElements(doc)[0], { knownKeys: rules.knownKeys });
  const issues = checkBlock(layout(model, doc), rules, doc);
  assert.deepEqual(issues.map((i) => i.target), ['option-missing:theme']);
  assert.deepEqual(counter(62, 70), { length: 62, max: 70, state: 'ok' });
  assert.equal(counter(63, 70).state, 'near');
  assert.equal(counter(71, 70).state, 'over');
  assert.equal(limitFor({ label: 'Primary button', type: 'button' }, null), 25);
  assert.equal(linkIssue('/rates'), '');
  assert.equal(linkIssue('https://northwind.example/rates'), '');
  assert.match(linkIssue('http://northwind.example'), /https/);
  assert.equal(altIssue('Couple holding keys to a new home'), '');
  assert.match(altIssue('DSC0042'), /file name/);
  assert.match(imageIssue({ width: 320, height: 200 }), /small \(320×200\)/);
  assert.match(imageIssue({ width: 1200, height: 800, bytes: 8e6 }), /large file \(7\.6 MB\)/);
});

test('ai: prompts name the block, item and field and ask for nothing else', () => {
  const block = { name: 'carousel', number: 2, lead: 'Savings that grow' };
  const prompt = fieldPrompt({
    action: 'shorten', block, where: 'Slide 1', label: 'Description', text: 'Earn "4.25%" APY on every dollar.', max: 120,
  });
  assert.match(prompt, /In the "carousel" block \(block 2 on the page, starting "Savings that grow"\), in Slide 1, change only the description/);
  assert.match(prompt, /currently reads: "Earn ”4\.25%” APY on every dollar\."/);
  assert.match(prompt, /at most 120 characters/);
  assert.match(prompt, /Do not change anything else/);
  assert.match(fieldPrompt({
    action: 'translate', block, label: 'Heading', text: 'Hi', language: 'French', max: 70,
  }), /Translate it to French\.\nKeep it within 70 characters\./);
  assert.match(altPrompt({ block, where: 'Slide 3', alt: '' }), /write new alt text for it\.\n/);
  assert.match(briefPrompt({
    block, brief: 'Spring savings push', noun: 'Slide', count: 3, options: ['theme'],
  }), /It has 3 slides.*settings rows \(theme\)/s);
  assert.throws(() => fieldPrompt({ action: 'nope', block, label: 'x' }));
});

test('config: typed options and the fields sheet configure a block without code', async () => {
  const optionRows = [
    {
      blocks: 'cards', key: 'Theme', values: 'Light=light|Dark=dark', label: 'Theme', type: 'select', default: 'light',
    },
    {
      blocks: 'cards', key: 'background', values: '', label: 'Block background', type: 'image',
    },
    { blocks: 'all', key: 'spacing', values: 'Small=s|Large=l' },
    { blocks: 'hero', key: 'notes', values: '' },
  ];
  const defs = parseOptionDefs(optionRows);
  assert.deepEqual([...defs.get('cards').keys()], ['theme', 'background', 'spacing']);
  const theme = defs.get('cards').get('theme');
  assert.deepEqual([theme.type, theme.default, theme.keyText, theme.values.map((v) => v.value)], ['select', 'light', 'theme', ['light', 'dark']]);
  assert.equal(defs.get('cards').get('spacing').type, 'select', 'values without a type are a select');
  assert.equal(defs.has('hero'), false, 'an untyped row with no values is skipped');
  assert.deepEqual(parseLibraryOptions(optionRows).get('cards').get('background'), [], 'EW options keep typed rows');

  const itemFields = parseItemFields([
    {
      block: 'cards', column: '2', name: 'title', type: 'heading', label: 'Card title', required: 'yes',
    },
    {
      block: 'cards', column: '2', name: 'body', type: 'text', max: '120',
    },
    {
      block: 'cards', column: '3', name: 'background', type: 'image', label: 'Card background',
    },
    { block: 'cards', column: '0', type: 'text' },
    { block: 'cards', column: '1', type: 'video' },
  ]);
  assert.deepEqual(itemFields.get('cards').map((f) => [f.c, f.type, f.label, f.required, f.max]), [
    [1, 'heading', 'Card title', true, 0], [1, 'text', 'Body', false, 120], [2, 'image', 'Card background', false, 0],
  ]);

  const rules = blockRules(parseRules(RULES_SHEET), 'Cards', new Map(), { optionDefs: defs, itemFields });
  assert.deepEqual([...rules.imageKeys], ['background']);
  assert.ok(rules.knownKeys.has('background') && rules.knownKeys.has('spacing'));
  assert.equal(fieldRule(rules, 'Card title', 'heading').required, true);
  assert.equal(fieldRule(rules, 'Card title', 'heading').max, 50, 'the type rule still applies to a named field');
  assert.equal(fieldRule(rules, 'Body', 'text').max, 120);
  assert.equal(fieldRule(rules, 'Offer summary', 'text', 'Description').required, true, 'a renamed field keeps the rule for its automatic name');
  const labelled = blockRules(parseRules([{
    block: 'cards', field: 'heading', label: 'Headline', max: '60',
  }]), 'cards', new Map());
  assert.equal(fieldRule(labelled, 'Heading', 'heading').label, 'Headline');
  assert.deepEqual([fieldRule(labelled, 'Card title', 'heading', 'Heading').label, fieldRule(labelled, 'Card title', 'heading', 'Heading').max], ['', 60], 'a library name wins over the rule\'s label, not its limits');
  assert.equal(rules.fields.get('theme').required, true, 'the block-studio sheet still applies');
  assert.equal(blockRules([], 'hero', new Map(), { optionDefs: defs }).optionDefs.get('spacing').type, 'select');
});

test('config: library variants are the documented class combinations, with heading and description', async () => {
  const doc = `<div><h2>Horizontal</h2><div class="cards horizontal"><div><div>a</div></div></div>
    <div class="library-metadata"><div><div>description</div><div>Image beside the text.</div></div></div>
    <div class="cards icons compact"><div><div>b</div></div></div>
    <h3>Plain</h3><div class="cards"><div><div>c</div></div></div>
    <h3>Same, reordered</h3><div class="cards compact icons"><div><div>d</div></div></div></div>`;
  const fake = async (url) => new Response(url.endsWith('/da') ? `<body><header></header><main>${doc}</main></body>` : doc);
  const variants = await libraryVariants([{ name: 'Cards', path: 'https://x.test/cards' }], 'cards', fake, DOMParser);
  assert.deepEqual(variants, [
    { value: 'horizontal', title: 'Horizontal', description: 'Image beside the text.' },
    { value: 'icons compact', title: 'Icons, Compact', description: '' },
  ], 'one choice per combination; the default example and a reordered duplicate add none');
  const fromDa = await libraryVariants([{ name: 'Cards', path: 'https://content.da.live/o/s/da' }], 'cards', fake, DOMParser);
  assert.deepEqual(fromDa.map((v) => v.value), ['horizontal', 'icons compact'], 'a whole DA document');
});

test('config: the library-metadata fields table names an example\'s fields', async () => {
  const meta = (labels) => `<div class="library-metadata"><div><div>fields</div><div><table>
    <tr><td>Fields</td></tr><tr>${labels.map((cell) => `<td>${cell.map((l) => `<p>${l}</p>`).join('')}</td>`).join('')}</tr>
  </table></div></div></div>`;
  const doc = `<div><div class="accordion"><div><div>Q?</div><div><p>A.</p></div></div></div>${meta([['Question'], ['Answer']])}
    <h2>Steps</h2><div class="accordion steps"><div><div>Step</div><div><p>Do it.</p></div></div></div>${meta([['Step'], ['How']])}</div>`;
  const lib = await libraryBlock([{ name: 'Accordion', path: 'https://x.test/accordion' }], 'accordion', async () => new Response(doc), { Parser: DOMParser });
  assert.deepEqual(lib.variants.map((v) => v.value), ['steps']);
  assert.deepEqual(lib.examples.map((e) => [e.id, e.fields.map((f) => f.label)]), [['', ['Question', 'Answer']], ['steps', ['Step', 'How']]]);
  assert.deepEqual(exampleFieldsFor(lib.examples, ['steps']).map((f) => f.label), ['Step', 'How'], 'the example with the same classes');
  assert.deepEqual(exampleFieldsFor(lib.examples, ['wide']).map((f) => f.label), ['Question', 'Answer'], 'else the default example');
  assert.deepEqual(exampleFieldsFor([], ['wide']), []);
  const sheet = [{ c: 1, type: 'text', label: 'Reply' }];
  assert.deepEqual(withLibraryFields(sheet, exampleFieldsFor(lib.examples)).map((f) => f.label), ['Reply', 'Question'], 'the fields sheet wins per column');
});

test('config: the library-metadata field-rules table sets limits, under the block\'s own rows', async () => {
  const doc = `<div><div class="accordion"><div><div>Q?</div><div><p>A.</p></div></div></div>
    <div class="library-metadata"><div><div>description</div><div>FAQs.</div></div><div><div>field-rules</div><div><table>
    <tr><td>Field rules</td></tr><tr><td>Hint</td><td>Field</td><td>Max</td></tr>
    <tr><td>Keep it short</td><td>Question</td><td>80</td></tr><tr><td></td><td>Answer</td><td>x</td></tr>
  </table></div></div></div>
    <div class="accordion steps"><div><div>Step</div><div><p>Do it.</p></div></div></div>
    <div class="library-metadata"><div><div>field-rules</div><div><table>
    <tr><td>Step</td><td>40</td><td>yes</td><td></td></tr>
  </table></div></div></div></div>`;
  const lib = await libraryBlock([{ name: 'Accordion', path: 'https://x.test/accordion' }], 'accordion', async () => new Response(doc), { Parser: DOMParser });
  assert.deepEqual(exampleRulesFor(lib.examples), [
    {
      field: 'question', max: 80, required: false, hint: 'Keep it short',
    },
    {
      field: 'answer', max: 0, required: false, hint: '',
    },
  ], 'columns by header, in any order');
  assert.deepEqual(exampleRulesFor(lib.examples, ['steps']), [{
    field: 'step', max: 40, required: true, hint: '',
  }], 'without a header: Field, Max, Required, Hint');
  assert.deepEqual(exampleFieldsFor(lib.examples), [], 'limits alone name nothing');
  const fieldRules = exampleRulesFor(lib.examples);
  const sheet = parseRules([
    {
      block: 'all', field: 'question', max: '200', required: 'yes',
    },
    { block: 'accordion', field: 'question', hint: 'Ask one thing' },
  ]);
  const rule = fieldRule(blockRules(sheet, 'accordion', null, { fieldRules }), 'Question', 'text');
  assert.equal(rule.max, 80, 'the library beats "all" rows');
  assert.equal(rule.required, true, 'what it leaves out still comes from them');
  assert.equal(rule.hint, 'Ask one thing', 'the block\'s own rows win');
  const itemFields = new Map([['accordion', [{
    c: 0, type: 'text', label: 'Question', max: 120,
  }]]]);
  assert.equal(fieldRule(blockRules([], 'accordion', null, { itemFields, fieldRules }), 'Question', 'text').max, 80, 'and the fields sheet');
});

test('config: the editor sheet marks repeating blocks as multi', () => {
  const multi = parseMultiBlocks([
    { block: 'Accordion', property: 'multi' }, { block: 'cards (dark)', property: ' Multi ' },
    { block: 'hero', property: 'other' }, { block: '', property: 'multi' },
  ]);
  assert.deepEqual([...multi], ['accordion', 'cards']);
  assert.equal(blockRules([], 'Accordion', new Map(), { multiBlocks: multi }).multi, true);
  assert.equal(blockRules([], 'hero', new Map(), { multiBlocks: multi }).multi, false);
});

test('config: the editors row limits who can change field names', async () => {
  const rules = parseRules([
    { block: '*', field: 'editors', values: 'Ana@Northwind.example, @admins.northwind.example' },
    { block: 'cards', field: 'editors', values: 'ignored@northwind.example' },
    { block: 'cards', field: 'title', max: '60' },
  ]);
  const editors = namingEditors(rules);
  assert.deepEqual(editors, ['ana@northwind.example', '@admins.northwind.example']);
  assert.equal(blockRules(rules, 'cards', null).fields.has('editors'), false, 'not a field');

  assert.equal(canEditNames([], ''), true, 'no list: DA permissions decide');
  assert.equal(canEditNames(editors, 'ANA@northwind.example'), true);
  assert.equal(canEditNames(editors, 'lee@admins.northwind.example'), true, '@domain');
  assert.equal(canEditNames(editors, 'lee@northwind.example'), false);
  assert.equal(canEditNames(editors, 'lee@evil-admins.northwind.example.com'), false);
  assert.equal(canEditNames(editors, ''), false, 'unknown person: no');

  const calls = [];
  const ok = async (url, opts) => {
    calls.push([url, opts.headers.Authorization]);
    return { ok: true, json: async () => ({ email: ' Ana@Northwind.example ' }) };
  };
  assert.equal(await imsEmail('tok', ok), 'ana@northwind.example');
  assert.deepEqual(calls, [[IMS_PROFILE, 'Bearer tok']]);
  assert.equal(await imsEmail('', ok), '', 'no token, no call');
  assert.equal(calls.length, 1);
  assert.equal(await imsEmail('tok', async () => ({ ok: false })), '');
  assert.equal(await imsEmail('tok', async () => { throw new Error('offline'); }), '');
});
