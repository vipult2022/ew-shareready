/**
 * Writes demo/handoff.json: the sample Northwind design, in the same shape the Figma plugin
 * sends. The panel uses it in demo mode, the tests analyse it, and the plugin's
 * "Create sample design" button draws it in Figma. Run: node tools/figma/demo/make-sample.mjs
 */

import { writeFileSync } from 'node:fs';

const W = 1440;
const PAD = 120;
let next = 0;
const id = () => {
  next += 1;
  return `1:${next}`;
};

const NAVY = '#0b2545';
const TEAL = '#13a89e';
const INK = '#1d2b3a';
const MIST = '#eef4f8';
const WHITE = '#ffffff';

function text(value, size, opts = {}) {
  const lines = Math.max(1, Math.ceil((value.length * size * 0.5) / (opts.w || 600)));
  return {
    type: 'TEXT',
    id: id(),
    name: opts.name || value.slice(0, 40),
    x: 0,
    y: 0,
    w: opts.w || 600,
    h: Math.round(lines * size * 1.35),
    text: value,
    size,
    weight: opts.weight || (size >= 22 ? 700 : 400),
    color: opts.color || INK,
    link: opts.link || '',
  };
}

function image(name, picture, w, h) {
  return {
    type: 'IMAGE', id: id(), name, x: 0, y: 0, w, h, image: picture,
  };
}

function button(label, link, primary = true) {
  return {
    type: 'FRAME',
    id: id(),
    name: primary ? 'Button / Primary' : 'Button / Secondary',
    x: 0,
    y: 0,
    w: 240,
    h: 56,
    layout: 'HORIZONTAL',
    filled: true,
    fill: primary ? TEAL : WHITE,
    stroke: primary ? '' : TEAL,
    radius: 28,
    padding: 16,
    gap: 0,
    align: 'CENTER',
    children: [text(label, 18, {
      w: 208, weight: 700, color: primary ? WHITE : TEAL, link,
    })],
  };
}

/** Auto layout: places children one after another and sizes the frame to fit. */
function frame(name, layout, children, opts = {}) {
  const padding = opts.padding ?? 0;
  const gap = opts.gap ?? 24;
  let pos = padding;
  let cross = 0;
  children.forEach((c) => {
    if (layout === 'HORIZONTAL') {
      c.x = pos;
      c.y = padding;
      pos += c.w + gap;
      cross = Math.max(cross, c.h);
    } else {
      c.x = padding;
      c.y = pos;
      pos += c.h + gap;
      cross = Math.max(cross, c.w);
    }
  });
  const main = pos - gap + padding;
  return {
    type: 'FRAME',
    id: id(),
    name,
    x: 0,
    y: 0,
    w: opts.w || (layout === 'HORIZONTAL' ? main : cross + padding * 2),
    h: opts.h || (layout === 'HORIZONTAL' ? cross + padding * 2 : main),
    layout,
    filled: !!opts.fill,
    fill: opts.fill || '',
    padding,
    gap,
    radius: opts.radius || 0,
    image: opts.image || '',
    children,
  };
}

const heroCopy = frame('Hero copy', 'VERTICAL', [
  text('Your first home, made simpler', 56, { w: 640, color: WHITE, name: 'Headline' }),
  text('Fixed rates from 5.9% APR, a decision in principle in minutes and a named advisor from offer to keys.', 20, { w: 560, color: WHITE, name: 'Intro' }),
  frame('Buttons', 'HORIZONTAL', [
    button('Check your rate', '/loans/home/rates'),
    button('Talk to an advisor', '', false),
  ], { gap: 16 }),
], { gap: 28 });
heroCopy.x = PAD;
heroCopy.y = 150;
const hero = {
  type: 'FRAME',
  id: id(),
  name: 'Hero',
  x: 0,
  y: 0,
  w: W,
  h: 600,
  layout: 'NONE',
  filled: true,
  fill: NAVY,
  image: 'hero',
  imageName: 'Family carrying moving boxes into their new home',
  children: [heroCopy],
};

const card = (title, body, pictureName, picture) => frame('Card', 'VERTICAL', [
  image(pictureName, picture, 384, 240),
  text(title, 24, { w: 384, color: NAVY }),
  text(body, 18, { w: 384 }),
], {
  w: 384, gap: 16, fill: WHITE, radius: 16,
});

const why = frame('Why Northwind', 'VERTICAL', [
  text('Why buyers choose Northwind', 36, { w: 1200, color: NAVY, name: 'Section title' }),
  frame('Card row', 'HORIZONTAL', [
    card('Rates locked for 90 days', 'Your rate is held from approval to completion, even if the market moves.', 'Calendar with a locked rate', 'lock'),
    card('One advisor, start to finish', 'The same named person answers every call, from your first question to the day you get the keys.', 'Rectangle 12', 'advisor'),
    card('No fees to switch later', 'Overpay up to 20% a year and move your mortgage with you when you move house.', 'Moving van outside a house', 'switch'),
  ], { gap: 24 }),
], {
  w: W, padding: PAD, gap: 40, fill: MIST,
});

const steps = frame('How it works', 'HORIZONTAL', [
  image('Keys handed over at the front door', 'keys', 560, 420),
  frame('Steps', 'VERTICAL', [
    text('Three steps to your keys', 36, { w: 560, color: NAVY, name: 'Section title' }),
    text('1. Check your rate in two minutes, with no effect on your credit score.', 18, { w: 560 }),
    text('2. Upload your documents from your phone and track every step online.', 18, { w: 560 }),
    text('3. Sign your offer and we pay the seller on completion day.', 18, { w: 560 }),
    button('Start your application', '/loans/home/apply'),
  ], { w: 560, gap: 20 }),
], {
  w: W, padding: PAD, gap: 80,
});

const question = (q, a) => frame('Question', 'VERTICAL', [
  text(q, 20, { w: 1200, weight: 700, color: NAVY }),
  text(a, 18, { w: 1200 }),
], { w: 1200, gap: 8 });

const faq = frame('FAQ', 'VERTICAL', [
  text('Questions buyers ask', 36, { w: 1200, color: NAVY, name: 'Section title' }),
  question('How much deposit do I need?', 'From 5% of the price. With a 10% deposit you get our lowest first-home rates.'),
  question('Can I apply with a partner?', 'Yes. Up to four people can apply together, and each one gets their own login.'),
  question('How long does approval take?', 'Most buyers get a decision in principle the same day and a full offer within two weeks.'),
], {
  w: W, padding: PAD, gap: 28,
});

const closing = frame('Closing call to action', 'VERTICAL', [
  text('Ready when you are', 36, { w: 1200, color: WHITE, name: 'Section title' }),
  text('Check your rate today. It takes two minutes and does not affect your credit score.', 20, { w: 1200, color: WHITE }),
  button('Check your rate', '/loans/home/rates'),
], {
  w: W, padding: PAD, gap: 24, fill: NAVY,
});

const tree = frame('Home loans landing', 'VERTICAL', [hero, why, steps, faq, closing], {
  w: W, gap: 0, fill: WHITE,
});

const pictures = {
  hero: { name: 'Family carrying moving boxes into their new home', file: 'media/hero.jpg' },
  lock: { name: 'Calendar with a locked rate', file: 'media/lock.jpg' },
  advisor: { name: 'Rectangle 12', file: 'media/advisor.jpg' },
  switch: { name: 'Moving van outside a house', file: 'media/switch.jpg' },
  keys: { name: 'Keys handed over at the front door', file: 'media/keys.jpg' },
};

const handoff = {
  id: 'sample-home-loans',
  name: 'Home loans landing',
  file: 'Northwind web',
  page: 'Website 2027',
  sender: 'Maya Chen (Design)',
  note: 'Signed off by Brand on 18 Nov. Please keep the hero copy as is.',
  path: '/loans/home-loans',
  sent: '2026-11-19T09:30:00.000Z',
  status: 'new',
  width: tree.w,
  height: tree.h,
  skipped: 3,
  thumbnail: 'thumbnail',
  images: Object.entries(pictures).map(([key, p]) => ({ id: key, name: p.name })),
  files: {
    thumbnail: 'media/thumbnail.jpg',
    ...Object.fromEntries(Object.entries(pictures).map(([key, p]) => [key, p.file])),
  },
  tree,
};

const out = new URL('./handoff.json', import.meta.url);
writeFileSync(out, `${JSON.stringify([handoff], null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(`Wrote ${out.pathname}: ${next} layers, ${tree.w}×${tree.h}`);
