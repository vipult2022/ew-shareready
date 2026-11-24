#!/usr/bin/env node
/**
 * Pre-ship checks for an Experience Workspace extension in tools/{name}.
 *
 *   node <skills>/building-ew-extensions/scripts/check-extension.mjs --name my-tool \
 *     [--root .] [--deny "customer-a,customer-b"]
 *
 * Errors (exit code 1): missing entry files, no static DA SDK import, files that would be
 * served but should not be, secret-like strings, secrets in wrangler [vars], invalid image.
 * Warnings: no SDK timeout or demo fallback, README gaps, missing icon or Marketplace image,
 * test folder not in npm test. --deny flags words (e.g. customer names) anywhere in the files.
 */

import {
  readFileSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import {
  join, relative, resolve, extname,
} from 'node:path';

const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.svg', '.toml', '.txt', '.yaml', '.yml']);
const SECRETS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Slack webhook URL', /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{10,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['JWT / IMS token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Notion secret', /\b(?:secret|ntn)_[A-Za-z0-9]{30,}/],
  ['Airtable token', /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}/],
  ['Figma token', /\bfigd_[A-Za-z0-9_-]{20,}/],
  ['Atlassian token', /\bATATT[A-Za-z0-9_=-]{20,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Meta app token', /access_token=\d{6,}(?:\||%7C)[a-f0-9]{32}/i],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{32,}/],
];
const PLACEHOLDERS = /\{(?:service|do something|what authors[^}]*|link to[^}]*|Known limits[^}]*)\}/;
const README_SECTIONS = [
  ['what it does', /^#{2,3} .*(what it does|what|overview|why)/im],
  ['try it / demo', /^#{2,3} .*(try|demo)/im],
  ['install', /^#{2,3} .*(install|set ?up|getting started)/im],
  ['configuration', /^#{2,3} .*config/im],
  ['troubleshooting', /^#{2,3} .*(troubleshoot|faq|problems)/im],
  ['privacy / security', /^#{2,3} .*(privacy|security)/im],
];

const results = [];
const error = (msg) => results.push(['error', msg]);
const warn = (msg) => results.push(['warn', msg]);
const pass = (msg) => results.push(['ok', msg]);

function parseArgs(argv) {
  const args = { root: process.cwd(), deny: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--name') { i += 1; args.name = argv[i]; } else if (argv[i] === '--root') { i += 1; args.root = resolve(argv[i]); } else if (argv[i] === '--deny') { i += 1; args.deny = String(argv[i] || '').split(',').map((w) => w.trim()).filter(Boolean); } else {
      console.error(`Unknown option ${argv[i]}\nUsage: check-extension.mjs --name {name} [--root .] [--deny "a,b"]`);
      process.exit(2);
    }
  }
  if (!args.name) {
    console.error('Usage: check-extension.mjs --name {name} [--root .] [--deny "a,b"]');
    process.exit(2);
  }
  return args;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Lines of .hlxignore, and whether a path would be served. Simple glob support (* and /*). */
function hlxIgnore(root) {
  const file = join(root, '.hlxignore');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
  const patterns = lines.map((l) => {
    const re = l.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(l.includes('/') ? `^${re.replace(/\/$/, '/.*')}$` : `(^|/)${re}$`);
  });
  return (rel) => patterns.some((p) => p.test(rel));
}

function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG' || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Entry pages: tools/{name}.html and/or pages inside tools/{name}/ (one per surface). */
function checkEntry(root, name, sources) {
  const dir = join(root, 'tools', name);
  const pages = [join(root, 'tools', `${name}.html`), ...readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => join(dir, f))]
    .filter((f) => existsSync(f));
  if (!pages.length) {
    error(`no entry page: add tools/${name}.html (or tools/${name}/{surface}.html) for EW to load`);
    return;
  }
  pages.forEach((page) => {
    const rel = relative(root, page).split('\\').join('/');
    const html = readFileSync(page, 'utf8');
    const src = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1]
      || html.match(/<script[^>]+src=["']([^"']+)["'][^>]+type=["']module["']/i)?.[1];
    if (!src) warn(`${rel} has no <script type="module" src="…">`);
    else if (src.startsWith('/') && !existsSync(join(root, src.replace(/^\//, '').split('?')[0]))) error(`${rel} loads ${src}, which does not exist`);
    else pass(`${rel} loads ${src}`);
  });

  const SDK = 'https://da.live/nx/utils/sdk.js';
  const staticImport = sources.filter(([, text]) => new RegExp(`^import\\s+\\w+\\s+from\\s+['"]${SDK.replace(/[./]/g, '\\$&')}['"]`, 'm').test(text));
  const dynamicImport = sources.filter(([, text]) => text.includes(`import('${SDK}')`) || text.includes(`import("${SDK}")`));
  if (dynamicImport.length) error(`dynamic import of the DA SDK in ${dynamicImport.map(([f]) => f).join(', ')}: it can miss EW's one-time init. Import it statically.`);
  if (!staticImport.length && !dynamicImport.length) warn('no DA SDK import found (fine for a page that never talks to EW)');
  if (staticImport.length) {
    pass(`static DA SDK import in ${staticImport.map(([f]) => f).join(', ')}`);
    const text = staticImport.map(([, t]) => t).join('\n');
    if (/Promise\.race/.test(text) && /setTimeout/.test(text)) pass('SDK is raced against a timeout');
    else warn('DA_SDK never resolves outside EW: race it against a timeout (about 4 s)');
    if (/demo/i.test(text)) pass('has a demo/fallback path');
    else warn('no demo mode found: Marketplace "Try" links and reviewers need ?demo=1');
    if (/capabilities/.test(text)) pass('checks SDK capabilities');
    else if (/sendHTMLReplace|subscribeLiveDocument|setPrompt|replace:\s*true/.test(text)) warn('uses optional SDK actions without checking sdk.capabilities');
  }
}

function checkServed(root, name, files) {
  const ignored = hlxIgnore(root);
  const shouldHide = files.filter((rel) => /\/(test|worker|docs)\//.test(rel) || /\/demo\/.*\.mjs$/.test(rel) || /\.md$/.test(rel));
  const served = shouldHide.filter((rel) => !ignored(rel));
  if (served.length) {
    const dirs = [...new Set(served.map((rel) => (rel.endsWith('.md') ? rel : rel.replace(/^(tools\/[^/]+\/(?:test|worker|docs|demo))\/.*$/, '$1/*'))))];
    error(`these would be served publicly; add to .hlxignore: ${dirs.join(', ')}`);
  } else pass('tests, worker, docs and notes are in .hlxignore');
}

function checkSecrets(files, root, deny) {
  let found = 0;
  files.filter((rel) => TEXT.has(extname(rel))).forEach((rel) => {
    const text = readFileSync(join(root, rel), 'utf8');
    SECRETS.forEach(([label, re]) => {
      if (re.test(text)) {
        found += 1;
        error(`${rel}: looks like a ${label}. Move it to a worker secret and rotate it.`);
      }
    });
    deny.forEach((word) => {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
        found += 1;
        error(`${rel}: contains denied word "${word}"`);
      }
    });
  });
  if (!found) pass(`no secret-like strings${deny.length ? ' or denied words' : ''}`);
}

function checkReadme(root, name) {
  const file = join(root, 'tools', name, 'README.md');
  if (!existsSync(file)) {
    warn(`tools/${name}/README.md is missing: the Marketplace needs a README anyone can install from`);
    return;
  }
  const text = readFileSync(file, 'utf8');
  const missing = README_SECTIONS.filter(([, re]) => !re.test(text)).map(([label]) => label);
  if (missing.length) warn(`README has no section for: ${missing.join(', ')}`);
  else pass('README has the expected sections');
  if (PLACEHOLDERS.test(text)) warn(`README still has template placeholders like ${text.match(PLACEHOLDERS)[0]}`);
}

function checkImages(root, name) {
  const dir = join(root, 'tools', name);
  if (['icon.svg', 'icon.png'].some((f) => existsSync(join(dir, f)))) pass('has an icon for the library sheet');
  else warn(`no tools/${name}/icon.svg: the library sheet's icon column needs one`);
  const image = join(dir, 'marketplace.png');
  if (!existsSync(image)) {
    warn(`no tools/${name}/marketplace.png (Marketplace card image, 1200×896 PNG)`);
    return;
  }
  const size = pngSize(image);
  if (!size) error('marketplace.png is not a valid PNG');
  else if (size.width !== 1200 || size.height !== 896) warn(`marketplace.png is ${size.width}×${size.height}; the Marketplace card uses 1200×896`);
  else pass('marketplace.png is 1200×896');
}

function checkWrangler(root, name) {
  const file = join(root, 'tools', name, 'worker', 'wrangler.toml');
  if (!existsSync(file)) return;
  let section = '';
  let bad = 0;
  let orgs = false;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (line.startsWith('[')) section = line;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (!m || section !== '[vars]') return;
    if (m[1] === 'ALLOWED_ORGS') orgs = true;
    if (/SECRET|TOKEN|PASSWORD|WEBHOOK|PRIVATE/.test(m[1]) && m[2]) {
      bad += 1;
      error(`wrangler.toml [vars] has ${m[1]} with a value: use  npx wrangler secret put ${m[1]}`);
    }
  });
  if (!orgs) warn('wrangler.toml [vars] has no ALLOWED_ORGS: the worker should serve only listed orgs or sites');
  if (!bad) pass('no secrets in wrangler.toml [vars]');
}

function checkTests(root, name) {
  const dir = join(root, 'tools', name, 'test');
  if (!existsSync(dir)) {
    warn(`no tools/${name}/test/: add node:test unit tests for lib/ (and the worker)`);
    return;
  }
  const pkg = join(root, 'package.json');
  const script = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).scripts?.test || '' : '';
  if (script.includes(`tools/${name}/test`)) pass('tests run with npm test');
  else warn(`package.json "test" does not include tools/${name}/test/`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { root, name } = args;
  const files = [`tools/${name}.html`, ...walk(join(root, 'tools', name)).map((f) => relative(root, f).split('\\').join('/'))]
    .filter((rel) => existsSync(join(root, rel)));
  if (!existsSync(join(root, 'tools', name))) {
    console.error(`tools/${name}/ does not exist under ${root}`);
    process.exit(2);
  }
  const sources = files
    .filter((rel) => /\.m?js$/.test(rel) && !/\/(test|worker)\//.test(rel))
    .map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]);

  checkEntry(root, name, sources);
  checkServed(root, name, files);
  checkSecrets(files, root, args.deny);
  checkReadme(root, name);
  checkImages(root, name);
  checkWrangler(root, name);
  checkTests(root, name);

  const icon = { ok: '✔', warn: '!', error: '✖' };
  results.forEach(([level, msg]) => console.log(`${icon[level]} ${msg}`));
  const errors = results.filter(([l]) => l === 'error').length;
  const warnings = results.filter(([l]) => l === 'warn').length;
  console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors ? 1 : 0);
}

main();
