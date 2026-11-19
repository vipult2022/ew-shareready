/**
 * What every tracker shares: the page label, the ReviewLoop data kept with each review
 * (round, reviewed snapshot, the author's own comments), and how a status becomes a state.
 */

import { sha256 } from './http.js';

export const STATUS_DEFAULTS = {
  review: 'In review',
  changes: 'Changes requested',
  approved: 'Approved',
  done: 'Done',
};

const PROPERTY_BUDGET = 32000;
const OWN_LIMIT = 40;

function utf8Length(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Status names from worker variables such as JIRA_STATUS_REVIEW, with the defaults. */
export function statusNames(env, prefix) {
  return Object.fromEntries(Object.entries(STATUS_DEFAULTS)
    .map(([state, name]) => [state, String(env[`${prefix}_STATUS_${state.toUpperCase()}`] || name).trim()]));
}

/** The label that ties a review to one page. */
export async function pageLabel({ org, site, path }) {
  return `rl-${(await sha256(`${org}/${site}${path}`)).slice(0, 16)}`;
}

/** The ReviewLoop state a status name means: review, changes, approved, done, or ''. */
export function stateByName(name, statuses = STATUS_DEFAULTS) {
  const wanted = String(name || '').toLowerCase();
  return ['approved', 'changes', 'done', 'review'].find((s) => statuses[s].toLowerCase() === wanted) || '';
}

/**
 * A reviewer who closes the review instead of approving it has still signed it off.
 * It only counts as "done" once ReviewLoop published the page.
 */
export function settle(state, prop = {}) {
  const closedInTracker = state === 'done' && !prop.publishedAt;
  return { state: closedInTracker ? 'approved' : state, closedInTracker };
}

/** Keeps the data under the 32 KB budget: drop the oldest own comments, then trim. */
export function fitProperty(value, budget = PROPERTY_BUDGET) {
  const fitted = { ...value, own: { ...(value.own || {}) } };
  const ownIds = Object.keys(fitted.own);
  ownIds.slice(0, Math.max(0, ownIds.length - OWN_LIMIT)).forEach((id) => delete fitted.own[id]);
  if (fitted.snapshot?.units) {
    fitted.snapshot = { ...fitted.snapshot, units: [...fitted.snapshot.units] };
    while (fitted.snapshot.units.length && utf8Length(fitted) > budget) {
      fitted.snapshot.units.pop();
      fitted.snapshot.complete = false;
    }
  }
  return fitted;
}

export function newProp({
  page, reviewType, user, snapshot,
}) {
  return {
    v: 1,
    org: page.org,
    site: page.site,
    path: page.path,
    reviewType,
    round: 1,
    requestedAt: new Date().toISOString(),
    requester: user,
    snapshot,
    own: {},
  };
}

/** After "Send back for review": the next round, with the author's note on their comment. */
export function resubmitProp(prop, {
  id, user, text, snapshot,
}) {
  const round = (prop.round || 1) + 1;
  return {
    ...prop,
    round,
    requestedAt: new Date().toISOString(),
    snapshot,
    own: {
      ...(prop.own || {}),
      [id]: { by: user || prop.requester || 'Author', text: text || `Sent back for review (round ${round}).` },
    },
  };
}

export function publishedProp(prop, { id, user, liveUrl }) {
  return {
    ...prop,
    publishedAt: new Date().toISOString(),
    own: { ...(prop.own || {}), [id]: { by: user || 'Author', text: `Published: ${liveUrl}` } },
  };
}

/** Comments as the panel shows them: the author's own ones by name, with their short text. */
export function withOwn(comments, own = {}) {
  return comments.map((c) => {
    const mine = own[c.id];
    return mine ? {
      ...c, author: mine.by, text: mine.text, own: true,
    } : { ...c, own: false };
  });
}
