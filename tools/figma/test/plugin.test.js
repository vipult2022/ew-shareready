import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { analyze } from '../lib/design.js';
import { convert } from '../lib/convert.js';

// code.js runs in Figma's sandbox. Outside Figma it only exposes its helpers.
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL('../plugin/code.js', import.meta.url), 'utf8'), sandbox);
const { simplify, describe, pictureId } = sandbox.ewHandoff;
const plain = (value) => JSON.parse(JSON.stringify(value));

const solid = (r, g, b) => [{ type: 'SOLID', color: { r, g, b } }];
const photo = [{ type: 'IMAGE', imageHash: 'abc' }];
const bb = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  absoluteBoundingBox: {
    x, y, width, height,
  },
});
const text = (id, characters, fontSize, y, extra = {}) => ({
  id, type: 'TEXT', name: characters, characters, fontSize, fontName: { family: 'Inter', style: extra.bold ? 'Bold' : 'Regular' }, fills: solid(0, 0, 0), ...bb(40, y, 600, fontSize * 1.4), ...extra,
});

function page() {
  return {
    id: '1:1',
    type: 'FRAME',
    name: 'Home loans',
    fills: solid(1, 1, 1),
    ...bb(1000, 500, 1440, 900),
    children: [
      {
        id: '1:2',
        type: 'FRAME',
        name: 'Hero',
        layoutMode: 'HORIZONTAL',
        fills: solid(0.9, 0.95, 1),
        ...bb(1000, 500, 1440, 500),
        children: [
          text('1:3', 'Your first home, sooner', 56, 560, { bold: true }),
          text('1:4', 'Fixed rates from 5.9% with no fees.', 20, 660),
          {
            id: '1:5', type: 'RECTANGLE', name: 'Family outside new home', fills: photo, ...bb(1800, 520, 560, 420),
          },
          {
            id: '1:6', type: 'VECTOR', name: 'Arrow', ...bb(1, 1, 10, 10),
          },
          { ...text('1:7', 'Hidden', 16, 700), visible: false },
        ],
      },
      {
        id: '1:8', type: 'RECTANGLE', name: 'Rectangle 12', fills: photo, ...bb(1000, 1100, 400, 200),
      },
    ],
  };
}

test('pictureId makes a safe picture key from a node id', () => {
  assert.equal(pictureId('1:5'), 'n1-5');
  assert.equal(pictureId('I12:34;56:78'), 'ni12-34-56-78');
  assert.match(pictureId('9'.repeat(200)), /^n9{59}$/);
});

test('simplify keeps text, pictures and layout, relative to the frame', () => {
  const ctx = {
    count: 0, pictures: [], skipped: 0, truncated: false,
  };
  const root = page();
  const tree = simplify(root, ctx, root.absoluteBoundingBox);
  assert.equal(tree.type, 'FRAME');
  const hero = tree.children[0];
  assert.equal(hero.layout, 'HORIZONTAL');
  assert.equal(hero.fill, '#e6f2ff');
  assert.deepEqual(plain(hero.children.map((c) => c.type)), ['TEXT', 'TEXT', 'IMAGE']);
  const [title] = hero.children;
  assert.equal(title.text, 'Your first home, sooner');
  assert.equal(title.size, 56);
  assert.equal(title.weight, 700);
  assert.equal(title.x, 40 - 1000);
  assert.deepEqual(plain(ctx.pictures.map((p) => p.id)), ['n1-5', 'n1-8']);
  assert.equal(ctx.skipped, 1);
});

test('describe counts what the designer is about to send', () => {
  const info = describe(page());
  assert.equal(info.ok, true);
  assert.equal(info.texts, 2);
  assert.equal(info.pictures, 2);
  assert.equal(info.unnamed, 1);
  assert.equal(info.w, 1440);
  assert.deepEqual(plain(describe(null)), { ok: false, reason: 'none' });
  assert.equal(describe({ type: 'TEXT', name: 'x' }).reason, 'type');
});

test('the plugin tree converts into an EW page', () => {
  const ctx = {
    count: 0, pictures: [], skipped: 0, truncated: false,
  };
  const root = page();
  const tree = simplify(root, ctx, root.absoluteBoundingBox);
  const { html } = convert(analyze({ name: 'Home loans', tree: plain(tree) }));
  assert.match(html, /<h1>Your first home, sooner<\/h1>/);
  assert.match(html, /Fixed rates from 5\.9% with no fees\./);
});
