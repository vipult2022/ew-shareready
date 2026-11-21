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
  loadSiteSettings, fieldRule, sheetRows,
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
        library: { data: [{ title: 'Blocks', path: '/blocks.json' }] },
        'block-studio': { data: [{ block: 'cards', field: 'heading', max: '40' }] },
      }));
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
  const settings = await loadSiteSettings(fetcher, { org: 'o', site: 's' }, fetcher);
  assert.equal(settings.rules[0].max, 40);
  assert.equal(settings.libraryOptions.get('cards').get('theme')[0].value, 'l');
  assert.equal(settings.libraryBlocks[0].name, 'Cards');
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
