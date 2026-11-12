/**
 * Builds the worker payloads for a new review and for "send back for review", so the
 * dialog and the panel send exactly the same thing.
 */

import { reviewDescription, rereviewComment } from './adf.js';

export function createPayload({
  page, title, type, due, note, requester, compared,
}) {
  const reviewType = type?.name || '';
  return {
    org: page.org,
    site: page.site,
    path: page.path,
    title,
    summary: `${reviewType || 'Content'} review: ${title}`.slice(0, 200),
    reviewType,
    assignee: type?.assignee || '',
    due,
    description: reviewDescription({
      page: { ...page, title },
      requester,
      reviewType,
      note,
      checklist: type?.checklist,
      changes: compared.sinceLive,
      firstVersion: compared.firstVersion,
    }),
    snapshot: compared.snapshot,
  };
}

export function resubmitPayload({
  page, title, review, note, requester, compared,
}) {
  return {
    org: page.org,
    site: page.site,
    path: page.path,
    key: review.key,
    text: note,
    comment: rereviewComment({
      page: { ...page, title },
      requester,
      note,
      changes: compared.sinceReview || [],
      round: (review.round || 1) + 1,
    }),
    snapshot: compared.snapshot,
  };
}
