/**
 * The request the panel hands to the Experience Workspace assistant. It carries the design
 * as an outline (sections, suggested blocks, exact text, picture URLs) and strict rules, so
 * the assistant lays the page out with the site's blocks but never rewrites the copy.
 */

const MAX_TEXT = 600;

const quote = (text) => `“${String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)}”`;

function line(item, { imageSrc, link }) {
  switch (item.kind) {
    case 'heading':
      return `H${item.level}: ${quote(item.text)}`;
    case 'text':
      return `Text: ${quote(item.text)}${item.link ? ` (links to ${item.link})` : ''}`;
    case 'button':
      return `Button: ${quote(item.text)} → ${item.link || link(item) || 'no link yet: use # and tell me'}`;
    case 'image': {
      const src = imageSrc(item.image);
      const alt = item.alt ? `alt ${quote(item.alt)}` : 'write short alt text that says what it shows';
      return `Image: ${src} (${alt})`;
    }
    default:
      return '';
  }
}

function cellLines(cell, opts, indent) {
  return cell.map((item) => `${indent}${line(item, opts)}`).filter((l) => l.trim());
}

function sectionLines(section, index, opts) {
  const out = [];
  const label = section.block === 'Text' ? 'default content' : `${section.block} block`;
  out.push(`${index + 1}. ${section.name}: ${label}`);
  (section.lead || []).forEach((item) => out.push(`   ${line(item, opts)}`));
  (section.items || []).forEach((item) => out.push(`   ${line(item, opts)}`));
  const rows = section.rows || [];
  if (rows.length === 1 && rows[0].length === 1) {
    out.push(...cellLines(rows[0][0], opts, '   '));
    return out;
  }
  rows.forEach((row, r) => {
    const name = { Cards: 'Card', Accordion: 'Item', Table: 'Row' }[section.block] || 'Row';
    out.push(`   ${name} ${r + 1}:`);
    row.forEach((cell, c) => {
      if (row.length > 1) out.push(`     Cell ${c + 1}:`);
      out.push(...cellLines(cell, opts, row.length > 1 ? '       ' : '     '));
    });
  });
  return out;
}

/**
 * The prompt. `opts.imageSrc(id)` is where each picture now lives in the site, `opts.blocks`
 * the block names the site has.
 */
export default function buildPrompt(handoff, model, {
  imageSrc = (id) => id, blocks = ['Hero', 'Cards', 'Columns', 'Accordion', 'Table'], link = () => '', metadata = true,
} = {}) {
  const opts = { imageSrc, link };
  const from = handoff.sender ? ` sent by ${handoff.sender}` : '';
  const out = [
    `Build this page from the Figma design “${handoff.name}”${from}. Add it to this document in the order below.`,
    'Rules:',
    '- Keep every text exactly as written: no rewording, shortening, translating or extra copy.',
    `- Use only these blocks from this site: ${blocks.join(', ')}${metadata ? ', Metadata' : ''}. Everything else is default content (headings, paragraphs, pictures).`,
    '- Follow my suggested block for each section unless the content clearly fits another one better.',
    '- Start a new section (a horizontal rule) between the numbered sections.',
    '- Put each image in as a picture from its URL, never as a link or text.',
    '- Make each button a link on its own line: the first in a group bold, the others italic.',
  ];
  if (metadata) {
    out.push(`- End the page with a Metadata block: Title ${quote(model.title)}${model.description ? ` and Description ${quote(model.description)}` : ''}.`);
  }
  out.push('', 'Design:');
  model.sections.forEach((s, i) => out.push(...sectionLines(s, i, opts)));
  out.push('', 'When you are done, list anything you could not place, and every image you wrote alt text for.');
  return out.join('\n');
}
