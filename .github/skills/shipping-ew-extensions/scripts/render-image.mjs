#!/usr/bin/env node
/**
 * Render an HTML file or URL to a PNG at an exact size (Marketplace image, panel screenshots).
 *
 *   node render-image.mjs --html tools/x/docs/marketplace.html --out tools/x/marketplace.png
 *   node render-image.mjs --url "http://localhost:3000/tools/x.html?demo=1" --width 340 --height 640 --scale 2 --out tools/x/docs/panel.png
 *
 * Uses playwright-core, playwright or puppeteer (whichever resolves from the current folder or NODE_PATH),
 * with installed Chrome/Edge/Chromium or CHROME_PATH. Install one: npm i -D playwright-core (no browser download).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]);
  return acc;
}, []));

if ((!args.html && !args.url) || !args.out) {
  console.error('Usage: render-image.mjs (--html file | --url url) --out file.png [--width 1200] [--height 896] [--scale 1] [--wait 300] [--selector css]');
  process.exit(2);
}

const width = Number(args.width || 1200);
const height = Number(args.height || 896);
const scale = Number(args.scale || 1);
const wait = Number(args.wait || 300);
const target = args.url || pathToFileURL(resolve(args.html)).href;
const out = resolve(args.out);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((p) => p && existsSync(p));
}

async function load(name) {
  try {
    const require = createRequire(pathToFileURL(`${process.cwd()}/`));
    return await import(pathToFileURL(require.resolve(name)).href);
  } catch {
    try { return await import(name); } catch { return null; }
  }
}

const executablePath = findChrome();
const pw = (await load('playwright-core')) || (await load('playwright'));
const pptr = pw ? null : await load('puppeteer');
if (!pw && !pptr) {
  console.error('Install a browser driver first: npm i -D playwright-core   (or puppeteer)');
  process.exit(1);
}

let browser;
try {
  if (pw) {
    const chromium = pw.chromium || pw.default.chromium;
    browser = await chromium.launch({ headless: true, ...(executablePath && { executablePath }) });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.goto(target, { waitUntil: 'networkidle' });
    if (args.selector) await page.waitForSelector(args.selector);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  } else {
    const puppeteer = pptr.default || pptr;
    browser = await puppeteer.launch({ headless: 'new', ...(executablePath && { executablePath }) });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.goto(target, { waitUntil: 'networkidle0' });
    if (args.selector) await page.waitForSelector(args.selector);
    await new Promise((r) => { setTimeout(r, wait); });
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  }
  console.log(`✔ ${out} (${width * scale}×${height * scale})`);
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
