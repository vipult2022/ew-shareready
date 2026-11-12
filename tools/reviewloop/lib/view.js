/**
 * Shared rendering: change cards, review status chips and small formatting helpers.
 * Everything from the page or Jira is inserted as text.
 */

import { h } from './dom.js';
import { changeTitle, summarize } from './diff.js';
import { trimContext } from './adf.js';

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const minutes = Math.round((now - t) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${plural(days, 'day')} ago`;
  return new Date(t).toLocaleDateString();
}

export function formatDate(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export const STATES = {
  none: { label: 'Not sent for review', tone: 'neutral', icon: '○' },
  review: { label: 'In review', tone: 'info', icon: '●' },
  changes: { label: 'Changes requested', tone: 'warning', icon: '●' },
  approved: { label: 'Approved', tone: 'pass', icon: '●' },
  done: { label: 'Done', tone: 'neutral', icon: '✓' },
  other: { label: 'Open', tone: 'neutral', icon: '●' },
};

export function statusChip(review) {
  const state = STATES[review?.state || 'none'] || STATES.other;
  // Boards name statuses freely ("In Progress" may mean "In review"), so show ReviewLoop's
  // state and keep the Jira status as a tooltip.
  const known = STATES[review?.state || 'none'] && review?.state !== 'other';
  const label = known ? state.label : review?.status || state.label;
  const title = review?.status ? `Jira status: ${review.status}` : undefined;
  return h('span', { class: `rl-chip rl-tone-${state.tone}`, title }, h('span', { 'aria-hidden': 'true' }, state.icon), label);
}

function words(segments) {
  return trimContext(segments, 8).map((seg) => {
    if (seg.op === 'del') return h('del', {}, seg.text);
    if (seg.op === 'ins') return h('ins', {}, seg.text);
    return h('span', {}, seg.text);
  }).flatMap((node, i) => (i ? [' ', node] : [node]));
}

function body(change) {
  if (change.type === 'added') {
    return h('p', { class: 'rl-change-text' }, h('ins', {}, change.text || 'New image'));
  }
  if (change.type === 'removed') {
    return h('p', { class: 'rl-change-text' }, h('del', {}, change.text || 'Image'));
  }
  const parts = [];
  if (change.words) parts.push(h('p', { class: 'rl-change-text' }, words(change.words)));
  else if (change.kind === 'image') parts.push(h('p', { class: 'rl-change-text' }, change.after || 'No alt text'));
  if (change.links) {
    parts.push(h(
      'p',
      { class: 'rl-change-link' },
      'Link: ',
      h('del', {}, change.links.before.join(', ') || 'none'),
      ' → ',
      h('ins', {}, change.links.after.join(', ') || 'none'),
    ));
  }
  return parts.length ? parts : h('p', { class: 'rl-change-text rl-muted' }, 'Formatting only');
}

export function changeCard(change) {
  return h(
    'li',
    { class: `rl-change rl-change-${change.type}` },
    h(
      'div',
      { class: 'rl-change-head' },
      h('span', { class: 'rl-change-where' }, change.location),
      h('span', { class: 'rl-change-what' }, changeTitle(change)),
    ),
    body(change),
  );
}

export function changeList(changes, empty = 'No content changes.') {
  if (!changes?.length) return h('p', { class: 'rl-empty' }, empty);
  return h('ol', { class: 'rl-changes' }, changes.map(changeCard));
}

export { summarize };

export function loader(label = 'Loading') {
  return h('div', { class: 'rl-state' }, h('span', { class: 'rl-loader', role: 'status', 'aria-label': label }));
}

export function notice(tone, title, ...rest) {
  return h('div', { class: `rl-notice rl-tone-${tone}`, role: tone === 'error' ? 'alert' : 'status' }, h('strong', {}, title), ...rest);
}
