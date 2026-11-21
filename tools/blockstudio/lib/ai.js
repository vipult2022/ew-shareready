/**
 * Prompts for the EW assistant. Block Studio does not call an AI service itself: it
 * asks the assistant (setPrompt with autoSend) to edit one field, or the whole block,
 * in the open page, then reads the result from the live document.
 */

export const TEXT_ACTIONS = [
  { id: 'shorten', label: 'Shorten' },
  { id: 'clearer', label: 'Make clearer' },
  { id: 'persuasive', label: 'More persuasive' },
  { id: 'grammar', label: 'Fix grammar' },
  { id: 'translate', label: 'Translate to…' },
  { id: 'custom', label: 'Your own instruction…' },
];

export const LANGUAGES = ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Japanese', 'Chinese (Simplified)', 'Hindi'];

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const quote = (text, max = 280) => {
  const clean = norm(text).replaceAll('"', '\u201d');
  return `"${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}"`;
};

/** "the "carousel" block (block 2 on the page, starting "Savings that grow")" */
export function blockRef({ name, number, lead }) {
  const start = norm(lead) ? `, starting ${quote(lead, 60)}` : '';
  return `the "${name}" block (block ${number} on the page${start})`;
}

const INSTRUCTIONS = {
  shorten: ({ max }) => `Shorten it${max ? ` to at most ${max} characters` : ''}, keeping the meaning.`,
  clearer: () => 'Make it clearer and easier to read, keeping the meaning.',
  persuasive: () => 'Make it more persuasive and specific, without exaggerating or adding claims.',
  grammar: () => 'Fix spelling, grammar and punctuation only.',
  translate: ({ language }) => `Translate it to ${language || 'Spanish'}.`,
  custom: ({ instruction }) => `${norm(instruction).replace(/[.!]?$/, '.')}`,
};

const KEEP = 'Keep its formatting and link URLs. Do not change anything else in the block or on the page, and do not add, remove or reorder rows.';

/**
 * A prompt that edits one field.
 * @param {object} p
 * @param {string} p.action one of TEXT_ACTIONS ids
 * @param {object} p.block {name, number, lead}
 * @param {string} p.where item or group title, e.g. "Slide 2"
 * @param {string} p.label field label, e.g. "Description"
 * @param {string} p.text the field's current text
 * @param {number} [p.max] character limit
 * @param {string} [p.language]
 * @param {string} [p.instruction]
 */
export function fieldPrompt({
  action, block, where, label, text, max, language, instruction,
}) {
  const make = INSTRUCTIONS[action];
  if (!make) throw new Error(`Unknown action ${action}`);
  const place = where ? `, in ${where}` : '';
  return [
    `Edit the page I have open. In ${blockRef(block)}${place}, change only the ${label.toLowerCase()}, which currently reads: ${quote(text)}.`,
    make({ max, language, instruction }),
    max && action !== 'shorten' ? `Keep it within ${max} characters.` : '',
    KEEP,
  ].filter(Boolean).join('\n');
}

/** A prompt that writes alt text for one image. */
export function altPrompt({ block, where, alt }) {
  const place = where ? `, in ${where}` : '';
  const now = norm(alt) ? ` Its current alt text is ${quote(alt, 125)}.` : '';
  return [
    `Edit the page I have open. In ${blockRef(block)}${place}, look at the image and write new alt text for it.${now}`,
    'Use one plain sentence under 125 characters that says what the image shows for someone who cannot see it. Do not start with "Image of".',
    'Set it as that image\'s alt text and change nothing else on the page.',
  ].join('\n');
}

/** A prompt that writes every text field of a block from a one-line brief. */
export function briefPrompt({
  block, brief, noun, count, options = [],
}) {
  const settings = options.length ? `, and the settings rows (${options.join(', ')})` : '';
  const items = count > 1 ? ` It has ${count} ${noun.toLowerCase()}s: write different copy for each one.` : '';
  return [
    `Edit the page I have open. Rewrite the text in ${blockRef(block)} for this brief: ${quote(brief, 400)}.${items}`,
    'Write every heading, eyebrow, description and button text in that block. Keep headings within 70 characters, descriptions within 300 and button text within 25.',
    `Keep the same rows and cells, every image, icon and link URL${settings}. Do not change anything outside that block.`,
  ].join('\n');
}
