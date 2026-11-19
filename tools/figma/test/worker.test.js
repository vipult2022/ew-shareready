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
  globalThis.fetch = async (url, init = {}) => {
    daCalls.push({ url: String(url), auth: init.headers?.Authorization });
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
  assert.deepEqual(await resp.json(), { ok: true, service: 'figma', configured: true });
});
