/**
 * Checks for a block: character limits, empty or broken buttons, alt text, links to
 * local or preview sites, empty items and the rules sheet's required fields and
 * allowed values. Each issue points at the field it is about, so the panel can jump
 * to it.
 */

import { fieldText, isEmptyField } from './model.js';
import { fieldRule } from './rules.js';

export const LIMITS = {
  heading: 70, text: 300, button: 25, alt: 125,
};

const NEAR = 0.9;
const PREVIEW_HOST = /(^|\.)(aem|hlx\d?)\.(page|live)$/;
const LOCAL_HOST = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\])$/;
const FILE_LIKE = /\.(jpe?g|png|gif|webp|svg|avif|heic|tiff?)$|^(img|image|dsc|photo|pic|screenshot|media)[-_ ]?[0-9a-f]+/i;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** The character limit for a slot: the rules sheet's `max`, else the default. */
export function limitFor(slot, rules) {
  const rule = fieldRule(rules, slot.label, slot.type, slot.auto);
  return Number(rule.max) || LIMITS[slot.type] || 0;
}

/** Counter state: ok, near (amber, ≥ 90%) or over (red). */
export function counter(length, max) {
  if (!max) return { length, max: 0, state: 'ok' };
  let state = 'ok';
  if (length > max) state = 'over';
  else if (length >= Math.ceil(max * NEAR)) state = 'near';
  return { length, max, state };
}

/** What is wrong with a link URL, or ''. */
export function linkIssue(href) {
  const url = norm(href);
  if (!url || url === '#') return 'has no link URL';
  let parsed;
  try {
    parsed = new URL(url, 'https://site.invalid/');
  } catch {
    return 'has a link URL that is not valid';
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return 'has a link type that is not allowed';
  if (LOCAL_HOST.test(parsed.hostname)) return 'links to a local address (localhost)';
  if (PREVIEW_HOST.test(parsed.hostname)) return 'links to a preview site (aem.page or aem.live). Use the live URL';
  if (parsed.protocol === 'http:') return 'uses http://. Use https://';
  return '';
}

/** What is wrong with alt text, or ''. */
export function altIssue(alt) {
  const text = norm(alt);
  if (!text) return 'has no alt text';
  if (FILE_LIKE.test(text)) return 'has alt text that looks like a file name';
  if (text.length > LIMITS.alt) return `has alt text over ${LIMITS.alt} characters`;
  return '';
}

/** Warnings for an image's pixel size and file size, when known. */
export function imageIssue(info) {
  if (!info) return '';
  const { width, height, bytes } = info;
  if (bytes && bytes > 5 * 1024 * 1024) return `is a large file (${(bytes / 1048576).toFixed(1)} MB). Pages load faster with images under 5 MB`;
  if (width && width < 400) return `is small (${width}×${height}) and may look blurry`;
  if (width && width > 6000) return `is very wide (${width}px). Pages load faster with smaller images`;
  return '';
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function linksIn(html, doc) {
  const div = doc.createElement('div');
  div.innerHTML = html || '';
  return [...div.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
}

/**
 * Checks a laid-out block.
 * @param {object} view the result of layout()
 * @param {object} rules blockRules() for this block (may be empty)
 * @param {Document} doc any document, used to read HTML
 * @param {Map<string, object>} [images] image src → {width, height, bytes}
 * @returns {Array<{level:'error'|'warn', target:string, where:string, message:string,
 *   prop?:string}>} prop names the input to focus when it is not the main one
 */
export function checkBlock(view, rules, doc, images = new Map()) {
  const issues = [];
  const add = (level, target, where, message, prop) => {
    if (issues.some((i) => i.target === target && i.message === message)) return;
    issues.push({
      level, target, where, message, ...(prop ? { prop } : {}),
    });
  };

  view.groups.forEach((group) => {
    const where = group.title;
    const slots = group.cells.flat();
    const present = slots.filter((slot) => slot.field);
    if (group.kind === 'item' && present.every((slot) => isEmptyField(slot.field, doc))) {
      add('warn', `row:${group.row.id}`, where, 'is empty');
    }
    slots.forEach((slot) => {
      const rule = fieldRule(rules, slot.label, slot.type, slot.auto);
      const { field } = slot;
      if (!field) {
        if (rule.required) add('error', `slot:${group.row.id}:${slot.c}:${slot.slot}`, where, `needs a ${slot.label.toLowerCase()}`);
        return;
      }
      const target = field.id;
      const name = slot.label;
      const text = fieldText(field, doc);
      const max = limitFor(slot, rules);
      if (rule.required && isEmptyField(field, doc)) add('error', target, where, `${name} is required`);
      switch (field.type) {
        case 'heading':
          if (!text) add('error', target, where, `${name} is empty`);
          break;
        case 'button': {
          if (!text) add('error', target, where, `${name} has no text`, 'text');
          const problem = linkIssue(field.href);
          if (problem) {
            const level = field.href && field.href !== '#' ? 'warn' : 'error';
            add(level, target, where, `${name} ${problem}`, 'href');
          }
          break;
        }
        case 'text':
          linksIn(field.value, doc).forEach((href) => {
            const problem = linkIssue(href);
            if (problem && href) add('warn', target, where, `A link in ${name.toLowerCase()} ${problem}`);
          });
          break;
        case 'image': {
          if (!field.src) {
            add('error', target, where, `${name} is missing`);
            break;
          }
          const alt = altIssue(field.alt);
          if (alt) add('warn', target, where, `${name} ${alt}`, 'alt');
          const size = imageIssue(images.get(field.src));
          if (size) add('warn', target, where, `${name} ${size}`, 'upload');
          break;
        }
        case 'icon':
          if (!field.name) add('warn', target, where, `${name}: pick an icon`);
          else if (rules?.icons?.length && !rules.icons.includes(field.name)) {
            add('warn', target, where, `${name} “${field.name}” is not one of the site's icons`);
          }
          break;
        default:
      }
      if (max && field.type !== 'image' && text.length > max) {
        add('warn', target, where, `${name} is ${text.length} characters (limit ${max})`);
      }
    });
  });

  view.options.forEach((option) => {
    const target = `option:${option.key}`;
    if (!rules?.optionDefs?.has(option.key)) {
      if (rules?.optionSheet) {
        add('warn', target, 'Block options', `${option.keyText} is not in the library's options sheet`);
      }
      return;
    }
    const values = rules.values?.get(option.key);
    if (!option.value) add('warn', target, 'Block options', `${option.keyText} has no value`);
    else if (values?.length
      && !values.some((v) => v.value === option.value || v.title === option.value)) {
      add('warn', target, 'Block options', `${option.keyText} “${option.value}” is not one of the allowed values`);
    }
  });
  const rank = (issue) => (issue.level === 'error' ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b));
}

export function healthText(issues) {
  if (!issues.length) return 'No issues';
  return `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`;
}
