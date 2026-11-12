/**
 * Builds Jira descriptions and comments in Atlassian Document Format (ADF) from a
 * change list: where, what, and the edit with removed words struck through.
 */

import { changeTitle, summarize } from './diff.js';

const text = (value, marks) => {
  const node = { type: 'text', text: String(value) };
  if (marks?.length) node.marks = marks;
  return node;
};
const strong = { type: 'strong' };
const strike = { type: 'strike' };
const red = { type: 'textColor', attrs: { color: '#bf2600' } };
const green = { type: 'textColor', attrs: { color: '#006644' } };
const link = (href) => ({ type: 'link', attrs: { href } });

const paragraph = (...content) => ({ type: 'paragraph', content: content.filter(Boolean) });
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const cell = (content, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: {},
  content: [paragraph(...content)],
});
const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(...item)] })),
});

/** Shortens long unchanged stretches so a reviewer reads the edit, not the paragraph. */
export function trimContext(segments, keep = 6) {
  return segments.map((seg, i) => {
    if (seg.op !== 'same') return seg;
    const words = seg.text.split(' ');
    const first = i === 0;
    const last = i === segments.length - 1;
    if (first && words.length > keep) return { ...seg, text: `… ${words.slice(-keep).join(' ')}` };
    if (last && words.length > keep) return { ...seg, text: `${words.slice(0, keep).join(' ')} …` };
    if (!first && !last && words.length > keep * 2) {
      return { ...seg, text: `${words.slice(0, keep).join(' ')} … ${words.slice(-keep).join(' ')}` };
    }
    return seg;
  });
}

function wordNodes(words) {
  const nodes = [];
  trimContext(words).forEach((seg, i) => {
    if (i) nodes.push(text(' '));
    if (seg.op === 'del') nodes.push(text(seg.text, [strike, red]));
    else if (seg.op === 'ins') nodes.push(text(seg.text, [strong, green]));
    else nodes.push(text(seg.text));
  });
  return nodes;
}

function changeNodes(change) {
  if (change.type === 'added') return [text(change.text || '(image)', [strong, green])];
  if (change.type === 'removed') return [text(change.text || '(image)', [strike, red])];
  const nodes = change.words ? wordNodes(change.words) : [];
  if (change.imageReplaced) {
    if (nodes.length) nodes.push(text(' · '));
    nodes.push(text('new image', [strong]));
    if (!change.words) nodes.push(text(change.after ? `: “${change.after}”` : ''));
  }
  if (change.links) {
    if (nodes.length) nodes.push(text(' · '));
    nodes.push(text('link: '), text(change.links.before.join(', ') || '(none)', [strike, red]));
    nodes.push(text(' → '), text(change.links.after.join(', ') || '(none)', [strong, green]));
  }
  return nodes.length ? nodes : [text('(formatting only)')];
}

/** A table of changes: Where | What | Change. */
export function changesTable(changes = []) {
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: true, layout: 'default' },
    content: [
      { type: 'tableRow', content: [cell([text('Where')], true), cell([text('What')], true), cell([text('Change')], true)] },
      ...changes.map((change) => ({
        type: 'tableRow',
        content: [
          cell([text(change.location || '')]),
          cell([text(changeTitle(change))]),
          cell(changeNodes(change)),
        ],
      })),
    ],
  };
}

function linkLine(page) {
  const items = [
    ['Preview', page.previewUrl],
    ['Open in Experience Workspace', page.editUrl],
    ['Live page', page.liveUrl],
  ].filter(([, href]) => href);
  return items.flatMap(([label, href], i) => [
    ...(i ? [text(' · ')] : []),
    text(label, [link(href)]),
  ]);
}

function changesSection(changes, sinceLabel) {
  if (!changes?.length) return [paragraph(text(`No content changes ${sinceLabel}.`))];
  return [
    heading(3, `What changed ${sinceLabel} (${summarize(changes)})`),
    changesTable(changes),
  ];
}

/**
 * The issue description for a new review.
 * @param {object} req { page: {title, path, previewUrl, editUrl, liveUrl}, requester,
 *   reviewType, due, note, checklist: string[], changes, firstVersion }
 */
export function reviewDescription(req) {
  const { page = {} } = req;
  const content = [
    paragraph(
      text(`${req.requester || 'An author'} asks for a `),
      text(`${req.reviewType || 'content'} review`, [strong]),
      text(` of “${page.title || page.path}” (${page.path}).`),
    ),
    paragraph(...linkLine(page)),
  ];
  if (req.note) {
    content.push({ type: 'panel', attrs: { panelType: 'info' }, content: [paragraph(text(req.note))] });
  }
  if (req.firstVersion) {
    content.push(paragraph(text('This page has never been published, so the whole page is new.', [strong])));
  } else {
    content.push(...changesSection(req.changes, 'since the live page'));
  }
  if (req.checklist?.length) {
    content.push(heading(3, 'Checklist'), bullets(req.checklist.map((item) => [text(`☐ ${item}`)])));
  }
  content.push(paragraph(text('Sent from Experience Workspace by ReviewLoop. Move this issue to the approved status when the page can go live.', [{ type: 'em' }])));
  return { type: 'doc', version: 1, content };
}

/** The comment for "Send back for review": only what changed since the last review. */
export function rereviewComment({
  page = {}, requester, note, changes, round,
}) {
  const content = [
    paragraph(
      text(`${requester || 'The author'} sent the page back for review`),
      text(round ? ` (round ${round})` : ''),
      text('. '),
      ...linkLine(page),
    ),
  ];
  if (note) content.push({ type: 'panel', attrs: { panelType: 'info' }, content: [paragraph(text(note))] });
  content.push(...changesSection(changes, 'since the last review'));
  return { type: 'doc', version: 1, content };
}

/** The comment added after publishing. */
export function publishedComment({ liveUrl, publisher, editsSinceApproval = 0 }) {
  const content = [paragraph(
    text('Published', [strong]),
    text(` by ${publisher || 'the author'}: `),
    text(liveUrl, [link(liveUrl)]),
  )];
  if (editsSinceApproval) {
    content.push(paragraph(text(`Published with ${editsSinceApproval} edit${editsSinceApproval === 1 ? '' : 's'} made after approval.`, [strong, red])));
  }
  return { type: 'doc', version: 1, content };
}

/** Plain text of an ADF document (for comments shown in the panel). */
export function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs?.text || '';
  if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
  if (node.type === 'inlineCard') return node.attrs?.url || '';
  const inner = (node.content || []).map(adfToText).join('');
  const blocks = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'panel', 'tableRow'];
  return blocks.includes(node.type) ? `${inner}\n` : inner;
}
