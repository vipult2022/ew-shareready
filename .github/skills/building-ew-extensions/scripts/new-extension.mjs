#!/usr/bin/env node
/**
 * Scaffolds a new Experience Workspace extension from ../assets/template.
 *
 *   node <skills>/building-ew-extensions/scripts/new-extension.mjs \
 *     --name my-tool --title "My Tool" [--worker] [--prefix mt] [--root .] [--dry-run]
 *
 * Creates tools/{name}.html and tools/{name}/ (controller, panel, CSS, lib, sample data,
 * tests, icon, README; with --worker also tools/{name}/worker/ and its tests). Then it
 *   - adds tools/{name}/test|worker|docs and demo/*.mjs to .hlxignore (every committed file is served),
 *   - adds tools/{name}/test/ to the "test" script in package.json when that script runs node --test.
 * It never overwrites: if any target file exists it stops before writing anything.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync,
} from 'node:fs';
import {
  dirname, join, relative, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, '../assets/template');
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: new-extension.mjs --name {kebab-name} [--title "Title"] [--prefix abc] [--worker] [--root .] [--dry-run]');
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const args = { worker: false, dryRun: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (argv[i] === undefined) usage(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--name') args.name = next();
    else if (arg === '--title') args.title = next();
    else if (arg === '--prefix') args.prefix = next();
    else if (arg === '--root') args.root = resolve(next());
    else if (arg === '--worker') args.worker = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') usage();
    else usage(`unknown option ${arg}`);
  }
  if (!args.name) usage('--name is required');
  if (!NAME.test(args.name) || args.name.length > 40) usage('--name must be kebab-case, start with a letter, max 40 characters');
  args.title = (args.title || args.name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')).trim();
  if (/[<>"`$\\]/.test(args.title)) usage('--title must not contain < > " ` $ or \\');
  args.prefix = args.prefix || args.name;
  if (!NAME.test(args.prefix)) usage('--prefix must be kebab-case');
  return args;
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const isWorkerFile = (rel) => rel.split(sep).includes('worker') || rel.endsWith('worker.test.js');

function fill(text, { name, title, prefix }) {
  return text.replaceAll('__NAME__', name).replaceAll('__TITLE__', title).replaceAll('__PREFIX__', prefix);
}

function updateHlxignore(root, name, worker, dryRun) {
  const file = join(root, '.hlxignore');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const wanted = [`tools/${name}/test/*`, `tools/${name}/docs/*`, `tools/${name}/demo/*.mjs`];
  if (worker) wanted.splice(1, 0, `tools/${name}/worker/*`);
  if (!lines.includes('*.md')) wanted.push(`tools/${name}/*.md`);
  const missing = wanted.filter((l) => !lines.includes(l));
  if (missing.length && !dryRun) {
    writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  }
  return missing;
}

function updatePackageJson(root, name, dryRun) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return 'no package.json: run the tests with  node --test tools/' + name + '/test/';
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const script = pkg.scripts?.test || '';
  const folder = `tools/${name}/test/`;
  if (script.includes(folder)) return 'package.json test script already includes the tests';
  if (!/\bnode\b.*--test\b/.test(script)) {
    return `package.json "test" does not use node --test: add ${folder} to your test runner yourself`;
  }
  if (!dryRun) {
    pkg.scripts.test = `${script} ${folder}`;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return `added ${folder} to the package.json test script`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(TEMPLATE)) usage(`template folder not found: ${TEMPLATE}`);
  if (!existsSync(join(args.root, 'tools')) && !existsSync(join(args.root, 'scripts'))) {
    console.warn(`Warning: ${args.root} has no tools/ or scripts/ folder. Is it an EDS site repo? Use --root.`);
  }
  const files = walk(TEMPLATE)
    .map((full) => ({ full, rel: relative(TEMPLATE, full) }))
    .filter(({ rel }) => args.worker || !isWorkerFile(rel))
    .map((f) => ({ ...f, dest: join(args.root, fill(f.rel, args)) }));
  const clashes = files.filter((f) => existsSync(f.dest));
  if (clashes.length) {
    console.error('Nothing was written. These files already exist:');
    clashes.forEach((f) => console.error(`  ${relative(args.root, f.dest)}`));
    process.exit(1);
  }
  files.forEach((f) => {
    if (args.dryRun) return;
    mkdirSync(dirname(f.dest), { recursive: true });
    writeFileSync(f.dest, fill(readFileSync(f.full, 'utf8'), args));
  });
  const ignored = updateHlxignore(args.root, args.name, args.worker, args.dryRun);
  const pkgNote = updatePackageJson(args.root, args.name, args.dryRun);

  const verb = args.dryRun ? 'Would create' : 'Created';
  console.log(`${verb} ${files.length} files:`);
  files.forEach((f) => console.log(`  ${relative(args.root, f.dest)}`));
  if (ignored.length) console.log(`${args.dryRun ? 'Would add' : 'Added'} to .hlxignore: ${ignored.join(', ')}`);
  console.log(pkgNote);
  console.log(`
Next:
  1. npm run lint && npm test
  2. npx -y @adobe/aem-cli up, then open http://localhost:3000/tools/${args.name}.html?demo=1
  3. Replace demo/sample.json and lib/items.js with your service's data shape.${args.worker ? `
  4. Point the worker at your service (worker/src/index.js toItems and routes, wrangler.toml).` : `
  4. No worker: if your service needs a secret or blocks browser CORS, rerun with --worker in a new name, or copy the worker from the template.`}
  5. Register it in da.live/config#/{org}/{site} → library sheet:
     ${args.title} | https://main--{site}--{org}.aem.page/tools/${args.name}.html | …/tools/${args.name}/icon.svg | inline
  6. Test in EW with ?ref=local, fill tools/${args.name}/README.md, then run: node ${join(HERE, 'check-extension.mjs')} --name ${args.name}`);
}

main();
