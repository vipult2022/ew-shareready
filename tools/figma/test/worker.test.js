/* global globalThis */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { siteLink, decodeImage } from '../worker/src/index.js';
import { resetState } from '../worker/src/http.js';

const KEY = 'team-key-123';
const SITE = { org: 'northwind', site: 'website' };
const PAGE = { ...SITE, path: '/offers/spring' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64');
const realFetch = globalThis.fetch;
let daStatus;
let daCalls;
let figmaCalls;
let figmaReply;

/* A fake Figma: the REST API, its image storage, and one picture on a host it must not fetch. */
const FILE = 'AbCdEf1234567890xyz';
const LINK = `https://www.figma.com/design/${FILE}/Northwind-web?node-id=1-2&t=x`;
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const S3 = 'https://s3-alpha-sig.figma.com/img/';
let frameDoc;

const restFrame = () => ({
  id: '1:2',
  name: 'Home loans landing',
  type: 'FRAME',
  layoutMode: 'VERTICAL',
  absoluteBoundingBox: {
    x: 0, y: 0, width: 1440, height: 1200,
  },
  children: [
    {
      id: '1:3',
      name: 'Hero',
      type: 'FRAME',
      fills: [{ type: 'IMAGE', imageRef: 'hero' }],
      children: [{
        id: '1:4', type: 'TEXT', name: 'Title', characters: 'Home loans made simple', style: { fontSize: 56, fontWeight: 700 },
      }],
    },
    {
      id: '1:5', name: 'Family at home', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'family' }],
    },
    {
      id: '1:6', name: 'Same photo again', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'family' }],
    },
    {
      id: '1:7', name: 'Animated', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'gif' }],
    },
    {
      id: '1:8', name: 'Elsewhere', type: 'RECTANGLE', fills: [{ type: 'IMAGE', imageRef: 'evil' }],
    },
  ],
});

const jsonResponse = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

function figmaFetch(url) {
  if (url.startsWith('https://api.figma.com/v1/')) {
    if (figmaReply) return new Response('{}', figmaReply);
    if (url.includes('/nodes?')) return jsonResponse({ name: 'Northwind web', nodes: { '1:2': { document: frameDoc } } });
    if (url.endsWith('/images')) {
      return jsonResponse({
        meta: {
          images: {
            hero: `${S3}hero`, family: `${S3}family`, gif: `${S3}gif`, evil: 'https://evil.example/pic.jpg',
          },
        },
      });
    }
    if (url.includes('/images/')) return jsonResponse({ images: { '1:2': 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/thumb' } });
  }
  if (url === `${S3}gif`) return new Response(GIF);
  if (url.startsWith(S3) || url.includes('amazonaws.com/images/')) return new Response(Buffer.from(JPEG, 'base64'));
  return new Response(null, { status: 404 });
}

function memoryKv() {
  const data = new Map();
  return {
    data,
    async put(key, value, { metadata } = {}) {
      data.set(key, { value, metadata });
    },
    async get(key, type) {
      const hit = data.get(key);
      if (!hit) return null;
      return type === 'json' ? JSON.parse(hit.value) : hit.value;
    },
    async getWithMetadata(key) {
      const hit = data.get(key);
      if (!hit) return { value: null, metadata: null };
      const { value: raw, metadata } = hit;
      const bytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(raw);
      const end = bytes.byteOffset + bytes.byteLength;
      return { value: bytes.buffer.slice(bytes.byteOffset, end), metadata };
    },
    async list({ prefix }) {
      return {
        keys: [...data.entries()].filter(([k]) => k.startsWith(prefix))
          .map(([name, { metadata }]) => ({ name, metadata })),
      };
    },
  };
}

let env;

beforeEach(() => {
  resetState();
  daStatus = 200;
  daCalls = [];
  env = { ALLOWED_ORGS: 'northwind', HANDOFF_KEY: KEY, HANDOFFS: memoryKv() };
  frameDoc = restFrame();
  figmaCalls = [];
  figmaReply = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://admin.da.live/') && !u.startsWith('https://api.aem.live/')) {
      figmaCalls.push({ url: u, token: init.headers?.['X-Figma-Token'] });
      return figmaFetch(u);
    }
    daCalls.push({ url: u, auth: init.headers?.Authorization });
    return new Response(null, { status: daStatus });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const handoff = (extra = {}) => ({
  name: 'Home loans landing',
  file: 'Northwind web',
  fileKey: 'abc123',
  frame: '1:2',
  sender: 'Maya Chen',
  path: '/loans/home-loans',
  tree: { type: 'FRAME', name: 'Home', children: [] },
  ...extra,
});

function call(route, body, { key = KEY, token, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (key && !token) headers.Authorization = `Bearer ${key}`;
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://figma.test/${route}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }), env);
}

const send = (extra, opts) => call('send', {
  ...SITE,
  handoff: handoff(extra?.handoff),
  images: extra?.images || {},
  thumbnail: extra?.thumbnail,
}, opts);

const panel = (route, body = {}, opts = {}) => call(route, { ...PAGE, ...body }, { token: 'ims-token', origin: 'https://da.live', ...opts });

test('plugin: sends a design with pictures and lists it', async () => {
  const resp = await send({ images: { hero: { name: 'Hero', data: JPEG }, logo: { name: 'Logo', data: PNG } }, thumbnail: JPEG });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('Access-Control-Allow-Origin'), '*');
  const { handoff: meta } = await resp.json();
  assert.match(meta.id, /^home-loans-landing-[0-9a-f]{8}$/);
  assert.equal(meta.status, 'new');
  assert.equal(meta.thumbnail, 'thumbnail');
  assert.equal(env.HANDOFFS.data.size, 4);
  assert.equal(env.HANDOFFS.data.get(`i:northwind/website/${meta.id}/logo`).metadata.type, 'image/png');

  const sent = await (await call('sent', SITE)).json();
  assert.equal(sent.handoffs.length, 1);
  assert.equal(sent.handoffs[0].name, 'Home loans landing');
  assert.equal(sent.handoffs[0].tree, undefined);
});

test('plugin: sending the same frame again updates it', async () => {
  const first = (await (await send()).json()).handoff;
  const second = (await (await send({ handoff: { note: 'v2' } })).json()).handoff;
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'updated');
  const other = (await (await send({ handoff: { frame: '9:9' } })).json()).handoff;
  assert.notEqual(other.id, first.id);
});

test('plugin: wrong or missing team key is refused', async () => {
  assert.equal((await send({}, { key: 'nope' })).status, 401);
  assert.equal((await send({}, { key: '' })).status, 401);
  assert.equal(env.HANDOFFS.data.size, 0);
});

test('plugin: other orgs and a worker without a key are refused', async () => {
  const resp = await call('send', { org: 'contoso', site: 'web', handoff: handoff() });
  assert.equal(resp.status, 403);
  delete env.HANDOFF_KEY;
  const setup = await send();
  assert.equal(setup.status, 500);
  assert.equal((await setup.json()).code, 'setup');
});

test('plugin: only JPEG and PNG pictures, and a tree is required', async () => {
  const gif = Buffer.from('GIF89a....').toString('base64');
  assert.equal((await send({ images: { a: { name: 'A', data: gif } } })).status, 415);
  assert.equal((await send({ images: { 'Bad Id!': { name: 'A', data: JPEG } } })).status, 400);
  const noTree = await call('send', { ...SITE, handoff: { name: 'x' } });
  assert.equal(noTree.status, 400);
});

test('decodeImage checks the first bytes', () => {
  assert.equal(decodeImage(JPEG).type, 'image/jpeg');
  assert.equal(decodeImage(PNG).type, 'image/png');
  assert.throws(() => decodeImage('not base64 at all!'));
});

test('panel: lists, opens and serves pictures with the author token', async () => {
  const { id } = (await (await send({ images: { hero: { name: 'Hero', data: JPEG } } })).json()).handoff;
  const listResp = await panel('handoffs');
  assert.equal(listResp.status, 200);
  assert.equal(listResp.headers.get('Access-Control-Allow-Origin'), 'https://da.live');
  assert.equal((await listResp.json()).handoffs[0].id, id);
  assert.ok(daCalls.some((c) => c.url === 'https://admin.da.live/source/northwind/website/offers/spring.html' && c.auth === 'Bearer ims-token'));

  const full = (await (await panel('handoff', { id })).json()).handoff;
  assert.equal(full.tree.type, 'FRAME');
  assert.deepEqual(full.images, [{ id: 'hero', name: 'Hero' }]);

  const pic = await panel('image', { id, image: 'hero' });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await pic.arrayBuffer())].slice(0, 3), [0xff, 0xd8, 0xff]);
  assert.equal((await panel('image', { id, image: 'gone' })).status, 404);
});

test('panel: refused without access to the page, or from another site', async () => {
  daStatus = 403;
  assert.equal((await panel('handoffs')).status, 403);
  daStatus = 200;
  assert.equal((await panel('handoffs', {}, { token: '', key: '' })).status, 401);
  assert.equal((await panel('handoffs', {}, { origin: 'https://evil.example' })).status, 403);
});

test('panel: mark built shows up for the designer, with only site links', async () => {
  const { id } = (await (await send()).json()).handoff;
  const url = 'https://da.live/canvas#/northwind/website/loans/home-loans';
  const ok = await panel('status', { id, status: 'built', url });
  assert.equal(ok.status, 200);
  const sent = (await (await call('sent', SITE)).json()).handoffs[0];
  assert.equal(sent.status, 'built');
  assert.equal(sent.url, url);
  assert.equal((await panel('status', { id, status: 'built', url: 'https://evil.example/x' })).status, 400);
  assert.equal((await panel('status', { id, status: 'shipped' })).status, 400);
  assert.equal((await panel('status', { id: 'missing-1', status: 'built' })).status, 404);
});

test('siteLink accepts only this site', () => {
  assert.ok(siteLink('https://da.live/canvas#/northwind/website/a/b', SITE));
  assert.ok(siteLink('https://main--website--northwind.aem.page/a', SITE));
  assert.ok(!siteLink('https://da.live/canvas#/contoso/website/a', SITE));
  assert.ok(!siteLink('https://main--website--contoso.aem.live/a', SITE));
  assert.ok(!siteLink('http://main--website--northwind.aem.page/a', SITE));
  assert.ok(!siteLink(['javascript', 'alert(1)'].join(':'), SITE));
});

test('GET /status reports setup', async () => {
  const resp = await worker.fetch(new Request('https://figma.test/status'), env);
  assert.deepEqual(await resp.json(), {
    ok: true, service: 'figma', configured: true, figmaApi: false,
  });
  env.FIGMA_TOKEN = 'figd_test';
  const withToken = await worker.fetch(new Request('https://figma.test/status'), env);
  assert.equal((await withToken.json()).figmaApi, true);
});

/* Paste a Figma link */

test('import: reads a frame from a Figma link, with its pictures', async () => {
  env.FIGMA_TOKEN = 'figd_test';
  const resp = await panel('import', { url: LINK });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.dropped, 2);
  assert.equal(body.handoff.source, 'link');
  assert.equal(body.handoff.status, 'new');
  assert.equal(body.handoff.thumbnail, 'thumbnail');
  assert.equal(body.handoff.file, 'Northwind web');

  const api = figmaCalls.filter((c) => c.url.startsWith('https://api.figma.com/'));
  assert.deepEqual(api.map((c) => c.url), [
    `https://api.figma.com/v1/files/${FILE}/nodes?ids=1%3A2`,
    `https://api.figma.com/v1/files/${FILE}/images`,
    `https://api.figma.com/v1/images/${FILE}?ids=1%3A2&format=jpg&scale=0.556`,
  ]);
  assert.ok(api.every((c) => c.token === 'figd_test'));
  assert.equal(figmaCalls.filter((c) => c.url === `${S3}family`).length, 1);
  assert.ok(!figmaCalls.some((c) => c.url.includes('evil.example')));

  const { id } = body.handoff;
  const full = (await (await panel('handoff', { id })).json()).handoff;
  assert.equal(full.link, `https://www.figma.com/design/${FILE}/?node-id=1-2`);
  assert.equal(full.dropped, 2);
  assert.deepEqual(full.images.map((i) => i.id), ['n1-3', 'n1-5', 'n1-6']);
  assert.deepEqual(full.tree.children.map((c) => c.image), ['n1-3', 'n1-5', 'n1-6']);
  assert.equal(full.tree.children[0].children[0].size, 56);
  assert.equal((await panel('image', { id, image: 'n1-6' })).status, 200);
  assert.equal((await panel('image', { id, image: 'thumbnail' })).headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await panel('image', { id, image: 'n1-7' })).status, 404);
});

test('import: the same frame sent from the plugin is updated, keeping the designer', async () => {
  env.FIGMA_TOKEN = 'figd_test';
  const sent = (await (await send({ handoff: { fileKey: FILE, frame: '1:2', note: 'Use the new rates' } })).json()).handoff;
  const imported = (await (await panel('import', { url: LINK })).json()).handoff;
  assert.equal(imported.id, sent.id);
  assert.equal(imported.status, 'updated');
  assert.equal(imported.sender, 'Maya Chen');
  const full = (await (await panel('handoff', { id: sent.id })).json()).handoff;
  assert.equal(full.note, 'Use the new rates');
  assert.equal(full.path, '/loans/home-loans');
});

test('import: needs a token, a frame link, an allowed file and page access', async () => {
  const none = await panel('import', { url: LINK });
  assert.equal(none.status, 501);
  assert.equal((await none.json()).code, 'no-token');
  env.FIGMA_TOKEN = 'figd_test';
  assert.equal((await panel('import', { url: 'https://example.com' })).status, 400);
  assert.equal((await panel('import', { url: `https://www.figma.com/design/${FILE}/Web` })).status, 400);
  env.FIGMA_FILES = 'OtherFile123456';
  assert.equal((await panel('import', { url: LINK })).status, 403);
  env.FIGMA_FILES = FILE;
  frameDoc = { id: '0:1', type: 'CANVAS', name: 'Page 1' };
  const page = await panel('import', { url: LINK });
  assert.equal(page.status, 400);
  assert.match((await page.json()).error, /whole Figma page/);
  daStatus = 403;
  figmaCalls = [];
  assert.equal((await panel('import', { url: LINK }, { token: 'no-access' })).status, 403);
  assert.equal(figmaCalls.length, 0);
});

test('import: explains Figma rate limits and refusals', async () => {
  env.FIGMA_TOKEN = 'figd_test';
  figmaReply = { status: 429, headers: { 'Retry-After': '2592000', 'X-Figma-Rate-Limit-Type': 'low' } };
  const monthly = await panel('import', { url: LINK });
  assert.equal(monthly.status, 429);
  const monthlyBody = await monthly.json();
  assert.equal(monthlyBody.code, 'figma-limit');
  assert.match(monthlyBody.error, /few API reads a month.*Figma plugin/);
  figmaReply = { status: 429, headers: { 'Retry-After': '90', 'X-Figma-Rate-Limit-Type': 'high' } };
  assert.match((await (await panel('import', { url: LINK })).json()).error, /Try again in 2 min/);
  figmaReply = { status: 403 };
  assert.match((await (await panel('import', { url: LINK })).json()).error, /FIGMA_TOKEN/);
  figmaReply = { status: 404 };
  assert.equal((await panel('import', { url: LINK })).status, 404);
  assert.equal(env.HANDOFFS.data.size, 0);
});
