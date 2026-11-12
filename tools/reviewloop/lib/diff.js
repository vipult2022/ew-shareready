/**
 * Compares two versions of a page (lists of units from blocks.js) and describes what
 * changed in words an author and a reviewer can read: "Top of page: 4.25% → 4.50%".
 */

import { clean } from './blocks.js';

const SEP = '\u0001';

function signature(unit) {
  return [unit.kind, unit.label || '', clean(unit.text), unit.src || '', (unit.links || []).join(' ')]
    .join(SEP);
}

/**
 * Longest common subsequence over two arrays of strings.
 * Returns operations in order: { op: 'same' | 'del' | 'ins', a?: index, b?: index }.
 */
export function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'same', a: i, b: j });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ op: 'del', a: i });
      i += 1;
    } else {
      ops.push({ op: 'ins', b: j });
      j += 1;
    }
  }
  for (; i < n; i += 1) ops.push({ op: 'del', a: i });
  for (; j < m; j += 1) ops.push({ op: 'ins', b: j });
  return ops;
}

function tokens(text) {
  return clean(text).split(' ').filter(Boolean);
}

/**
 * Word-level diff: [{ op: 'same' | 'del' | 'ins', text }], neighbouring words merged.
 */
export function diffWords(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  const segments = [];
  lcsOps(a, b).forEach(({ op, a: i, b: j }) => {
    const word = op === 'ins' ? b[j] : a[i];
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += ` ${word}`;
    else segments.push({ op, text: word });
  });
  return segments;
}

/**
 * The edits inside a changed text, as short "before → after" pairs with a little context,
 * e.g. [{ before: '4.25%', after: '4.50%', context: 'earn … APY' }].
 */
export function wordEdits(segments) {
  const edits = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (seg.op === 'same') {
      i += 1;
    } else {
      const edit = { before: '', after: '' };
      while (i < segments.length && segments[i].op !== 'same') {
        if (segments[i].op === 'del') edit.before = clean(`${edit.before} ${segments[i].text}`);
        else edit.after = clean(`${edit.after} ${segments[i].text}`);
        i += 1;
      }
      edits.push(edit);
    }
  }
  return edits;
}

function similarity(a, b) {
  const x = new Set(tokens(a.text.toLowerCase()));
  const y = new Set(tokens(b.text.toLowerCase()));
  if (!x.size && !y.size) return 1;
  let shared = 0;
  x.forEach((w) => { if (y.has(w)) shared += 1; });
  return shared / (x.size + y.size - shared);
}

function canPair(del, ins, onlyPair) {
  if (del.kind !== ins.kind) return false;
  if (del.kind === 'meta') return del.label.toLowerCase() === ins.label.toLowerCase();
  if (del.kind === 'image') return del.location === ins.location || del.text === ins.text || onlyPair;
  if (onlyPair) return true;
  return similarity(del, ins) >= 0.3 || (del.location === ins.location && similarity(del, ins) > 0);
}

function linkChange(before, after) {
  const a = (before.links || []).join(' ');
  const b = (after.links || []).join(' ');
  return a === b ? null : { before: before.links || [], after: after.links || [] };
}

function changed(before, after) {
  const change = {
    type: 'changed',
    kind: after.kind,
    location: after.location,
    before: before.text,
    after: after.text,
  };
  if (after.label) change.label = after.label;
  if (after.kind === 'image' || after.src || before.src) {
    change.imageReplaced = (before.src || '') !== (after.src || '');
  }
  if (clean(before.text) !== clean(after.text)) {
    change.words = diffWords(before.text, after.text);
    change.edits = wordEdits(change.words);
  }
  const links = linkChange(before, after);
  if (links) change.links = links;
  return change;
}

function single(type, unit) {
  const change = {
    type, kind: unit.kind, location: unit.location, text: unit.text,
  };
  if (unit.label) change.label = unit.label;
  if (unit.src) change.src = unit.src;
  return change;
}

/** Pairs the deletions and insertions between two unchanged stretches. */
function flush(dels, inss, out) {
  const used = new Set();
  const sameKind = (kind) => [dels, inss].map((list) => list.filter((u) => u.kind === kind).length);
  const pairs = new Map();
  inss.forEach((ins, j) => {
    const [d, i] = sameKind(ins.kind);
    const onlyPair = d === 1 && i === 1;
    const k = dels.findIndex((del, idx) => !used.has(idx) && canPair(del, ins, onlyPair));
    if (k >= 0) {
      used.add(k);
      pairs.set(j, k);
    }
  });
  dels.forEach((del, k) => {
    if (!used.has(k)) out.push(single('removed', del));
  });
  inss.forEach((ins, j) => {
    out.push(pairs.has(j) ? changed(dels[pairs.get(j)], ins) : single('added', ins));
  });
}

/**
 * Compares two versions of a page.
 * @param {Array} before units of the older version (live, or the last review)
 * @param {Array} after units of the newer version (the current preview)
 * @returns {Array} changes in page order
 */
export function diffUnits(before = [], after = []) {
  const ops = lcsOps(before.map(signature), after.map(signature));
  const out = [];
  let dels = [];
  let inss = [];
  ops.forEach(({ op, a, b }) => {
    if (op === 'del') dels.push(before[a]);
    else if (op === 'ins') inss.push(after[b]);
    else {
      if (dels.length || inss.length) flush(dels, inss, out);
      dels = [];
      inss = [];
    }
  });
  if (dels.length || inss.length) flush(dels, inss, out);
  return out;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "3 changes: 2 edited, 1 added" or "No changes". */
export function summarize(changes = []) {
  if (!changes.length) return 'No changes';
  const count = (type) => changes.filter((c) => c.type === type).length;
  const parts = [['changed', 'edited'], ['added', 'added'], ['removed', 'removed']]
    .map(([type, label]) => [count(type), label])
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return `${plural(changes.length, 'change')}: ${parts.join(', ')}`;
}

/** What a change is about, for headings in the dialog and the Jira ticket. */
export function changeTitle(change) {
  const what = {
    heading: 'Heading',
    text: 'Text',
    list: 'List item',
    image: 'Image',
    meta: change.label || 'Metadata',
  }[change.kind] || 'Content';
  if (change.type === 'added') return `${what} added`;
  if (change.type === 'removed') return `${what} removed`;
  if (change.kind === 'image') {
    if (change.imageReplaced) return 'Image replaced';
    return 'Image alt text changed';
  }
  if (!change.words && change.links) return 'Link changed';
  return `${what} changed`;
}

/** Keeps a page's units small enough to store with the review (Jira property ≤ 32 KB). */
export function toSnapshot(units = [], budget = 30000) {
  const rows = units.map((u) => [u.kind, u.location, u.text.slice(0, 600), u.label || '', u.src || '', (u.links || []).join(' ')]);
  while (rows.length && JSON.stringify(rows).length > budget) rows.pop();
  return { v: 1, units: rows, complete: rows.length === units.length };
}

export function fromSnapshot(snapshot) {
  return (snapshot?.units || []).map(([kind, location, text, label, src, links]) => {
    const unit = { kind, location, text };
    if (label) unit.label = label;
    if (src) unit.src = src;
    if (links) unit.links = links.split(' ');
    return unit;
  });
}
