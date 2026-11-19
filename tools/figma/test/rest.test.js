import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFigmaLink, fromRest, dropPictures, pictureId, LinkError,
} from '../lib/rest.js';
import { analyze } from '../lib/design.js';

const KEY = 'AbCdEf1234567890xyz';
const black = {
  type: 'SOLID',
  color: {
    r: 0, g: 0, b: 0, a: 1,
  },
};
const bb = (x, y, width, height) => ({
  x, y, width, height,
});

test('parseFigmaLink reads design, file, prototype and branch links', () => {
  assert.deepEqual(parseFigmaLink(`https://www.figma.com/design/${KEY}/Northwind-web?node-id=12-345&t=abc-1`), {
    fileKey: KEY, nodeId: '12:345', url: `https://www.figma.com/design/${KEY}/?node-id=12-345`,
  });
  assert.equal(parseFigmaLink(`https://figma.com/file/${KEY}/Web?node-id=1%3A2`).nodeId, '1:2');
  assert.equal(parseFigmaLink(` https://www.figma.com/proto/${KEY}/Web?node-id=3-4 `).nodeId, '3:4');
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${KEY}/branch/BrAnCh1234567890/Web?node-id=1-2`).fileKey, 'BrAnCh1234567890');
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${KEY}/Web?node-id=I1-2;3-4`).nodeId, 'I1:2;3:4');
});

test('parseFigmaLink explains links it cannot use', () => {
  const bad = [
    ['not a link', /Paste a link/],
    [`http://www.figma.com/design/${KEY}/Web?node-id=1-2`, /figma\.com link/],
    [`https://figma.com.evil.example/design/${KEY}/Web?node-id=1-2`, /figma\.com link/],
    [`https://www.figma.com/board/${KEY}/Web?node-id=1-2`, /design file/],
    ['https://www.figma.com/design/short/Web?node-id=1-2', /cut off/],
    [`https://www.figma.com/design/${KEY}/Web`, /whole file/],
    [`https://www.figma.com/design/${KEY}/Web?node-id=abc`, /does not point to a frame/],
  ];
  bad.forEach(([url, message]) => assert.throws(
    () => parseFigmaLink(url),
    (e) => e instanceof LinkError && message.test(e.message),
    url,
  ));
});

test('fromRest gives the same tree shape as the plugin', () => {
  const frame = {
    id: '1:2',
    name: 'Home loans landing',
    type: 'FRAME',
    layoutMode: 'VERTICAL',
    absoluteBoundingBox: bb(100, 50, 1440, 1200),
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
    children: [
      {
        id: '1:3',
        name: 'Hero',
        type: 'FRAME',
        absoluteBoundingBox: bb(100, 50, 1440, 500),
        fills: [{ type: 'IMAGE', imageRef: 'ref-hero' }],
        children: [{
          id: '1:4',
          name: 'Title',
          type: 'TEXT',
          characters: 'Home loans made simple',
          style: { fontSize: 56, fontWeight: 700 },
          fills: [black],
          absoluteBoundingBox: bb(140, 120, 800, 70),
        }, {
          id: '1:5',
          name: 'Apply now',
          type: 'TEXT',
          characters: 'Apply now today',
          style: { fontSize: 16, fontWeight: 400 },
          characterStyleOverrides: [1, 1, 1, 1, 1, 1, 1, 1, 1],
          styleOverrideTable: { 1: { fontSize: 18, hyperlink: { type: 'URL', url: 'https://northwind.example/apply' } } },
          fills: [black],
          absoluteBoundingBox: bb(140, 300, 200, 24),
        }],
      },
      {
        id: '1:6', name: 'Family at home', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'ref-family' }], absoluteBoundingBox: bb(100, 600, 600, 400),
      },
      {
        id: '1:7', name: 'Hidden', type: 'TEXT', visible: false, characters: 'Secret', absoluteBoundingBox: bb(0, 0, 1, 1),
      },
      {
        id: '1:8', name: 'Hidden fill', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'x', visible: false }], absoluteBoundingBox: bb(0, 0, 1, 1),
      },
      {
        id: '1:9', name: 'Logo', type: 'VECTOR', absoluteBoundingBox: bb(0, 0, 1, 1),
      },
      {
        id: '1:10', name: 'Empty', type: 'TEXT', characters: '  ',
      },
    ],
  };
  const out = fromRest(frame);
  assert.equal(out.name, 'Home loans landing');
  assert.equal(out.width, 1440);
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.pictures, [
    { id: 'n1-3', ref: 'ref-hero', name: 'Hero' },
    { id: 'n1-6', ref: 'ref-family', name: 'Family at home' },
  ]);
  const [hero, family] = out.tree.children;
  assert.equal(out.tree.children.length, 2);
  assert.deepEqual({ ...out.tree, children: [] }, {
    type: 'FRAME', id: '1:2', name: 'Home loans landing', x: 0, y: 0, w: 1440, h: 1200, layout: 'VERTICAL', filled: true, fill: '#ffffff', image: '', children: [],
  });
  assert.equal(hero.image, 'n1-3');
  assert.equal(hero.imageName, '');
  assert.deepEqual(hero.children[0], {
    type: 'TEXT', id: '1:4', name: 'Title', x: 40, y: 70, w: 800, h: 70, text: 'Home loans made simple', size: 56, weight: 700, color: '#000000', link: '',
  });
  assert.equal(hero.children[1].size, 18);
  assert.equal(hero.children[1].weight, 400);
  assert.equal(hero.children[1].link, 'https://northwind.example/apply');
  assert.deepEqual(family, {
    type: 'IMAGE', id: '1:6', name: 'Family at home', x: 0, y: 550, w: 600, h: 400, image: 'n1-6',
  });
  assert.ok(analyze({ name: out.name, tree: out.tree }).sections.length > 0);
});

test('fromRest wants a visible frame', () => {
  assert.throws(() => fromRest(null), /not in the Figma file/);
  assert.throws(() => fromRest({ type: 'CANVAS', id: '0:1' }), /whole Figma page/);
  assert.throws(() => fromRest({ type: 'TEXT', id: '1:1' }), /single layer/);
  assert.throws(() => fromRest({ type: 'FRAME', id: '1:1', visible: false }), /hidden/);
});

test('dropPictures removes pictures that could not be brought in', () => {
  const tree = {
    type: 'FRAME',
    image: 'a',
    children: [
      { type: 'IMAGE', image: 'b' },
      { type: 'IMAGE', image: 'c' },
      { type: 'FRAME', image: 'b', children: [{ type: 'IMAGE', image: 'b' }] },
    ],
  };
  dropPictures(tree, new Set(['a', 'b']));
  assert.deepEqual(tree, {
    type: 'FRAME',
    image: '',
    children: [{ type: 'IMAGE', image: 'c' }, { type: 'FRAME', image: '', children: [] }],
  });
  assert.equal(pictureId('I1:2;3:4'), 'ni1-2-3-4');
});
