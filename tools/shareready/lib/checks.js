import { DEFAULT_IMAGE } from './extract.js';
import { layoutAll } from './platforms.js';
import { normalize } from './measure.js';

export const SEVERITY = ['error', 'warning', 'info', 'pass'];
const PENALTY = {
  error: 18, warning: 7, info: 0, pass: 0,
};
const IDEAL_RATIO = 1.91;

function names(layouts) {
  return layouts.map((l) => l.platform.label).join(', ');
}

function isSvg(url) {
  return /\.svg($|[?#])/i.test(url || '');
}

function sourceLabel(source) {
  return {
    metadata: 'the Metadata block',
    bulk: 'bulk metadata',
    h1: 'the first H1',
    heading: 'the first heading',
    paragraph: 'the first long paragraph',
    content: 'the first image on the page',
    default: 'the site default',
  }[source] || 'nowhere';
}

/**
 * Normalises query-index rows to { path, title, description } and drops the current page.
 */
export function indexEntries(index, currentPath) {
  const rows = Array.isArray(index) ? index : index?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.path && r.path !== currentPath)
    .map((r) => ({
      path: r.path, title: normalize(r.title), description: normalize(r.description),
    }));
}

function findDuplicates(value, entries, field) {
  const v = normalize(value).toLowerCase();
  if (!v) return [];
  return entries.filter((e) => e[field] && e[field].toLowerCase() === v).map((e) => e.path);
}

function titleChecks(page, layouts, out) {
  const { title } = page;
  if (!title.value) {
    out.push({
      id: 'title-missing',
      severity: 'error',
      field: 'title',
      title: title.source === 'empty' ? 'Title row is empty' : 'No title',
      detail: title.source === 'empty'
        ? 'The Metadata block has an empty Title, so EDS publishes no title at all.'
        : 'There is no Metadata title and no heading to fall back to.',
      fix: 'metadata',
    });
    return;
  }
  if (title.source === 'h1' || title.source === 'heading') {
    out.push({
      id: 'title-auto',
      severity: 'info',
      field: 'title',
      title: `Title comes from ${sourceLabel(title.source)}`,
      detail: 'Headlines are written for the page, not for search results. A Metadata Title lets you write one for sharing.',
      fix: 'metadata',
    });
  }
  const cut = layouts.filter((l) => l.title?.truncated);
  if (cut.length) {
    const google = cut.find((l) => l.platform.id === 'google');
    out.push({
      id: 'title-truncated',
      severity: 'warning',
      field: 'title',
      title: `Title is cut off on ${cut.length} of ${layouts.filter((l) => l.title).length} platforms`,
      detail: google
        ? `Google shows “${google.title.text}” (${Math.round(google.title.width)}px of ${google.title.max}px). Also cut on ${names(cut.filter((l) => l !== google)) || 'no others'}.`
        : `Cut on ${names(cut)}.`,
      platforms: cut.map((l) => l.platform.id),
      fix: 'metadata',
    });
  } else {
    out.push({
      id: 'title-fits', severity: 'pass', field: 'title', title: 'Title fits on every platform',
    });
  }
  if (title.value.length < 15) {
    out.push({
      id: 'title-short',
      severity: 'warning',
      field: 'title',
      title: 'Title is very short',
      detail: `“${title.value}” gives searchers little to go on. Aim for 30–60 characters.`,
      fix: 'ai',
    });
  }
}

function descriptionChecks(page, layouts, out) {
  const { description } = page;
  if (!description.value) {
    out.push({
      id: 'description-missing',
      severity: 'error',
      field: 'description',
      title: description.source === 'empty' ? 'Description row is empty' : 'No description',
      detail: 'Cards show no summary, and Google picks random text from the page.',
      fix: 'metadata',
    });
    return;
  }
  if (description.source === 'paragraph') {
    out.push({
      id: 'description-auto',
      severity: description.truncated ? 'warning' : 'info',
      field: 'description',
      title: description.truncated
        ? 'Description is cut mid-sentence'
        : 'Description comes from the first paragraph',
      detail: description.truncated
        ? 'EDS takes the first 25 words of the first long paragraph and adds “ ...”.'
        : 'Write one in the Metadata block to control what people read before they click.',
      fix: 'metadata',
    });
  }
  const google = layouts.find((l) => l.platform.id === 'google');
  const len = description.value.length;
  if (google?.description?.truncated) {
    out.push({
      id: 'description-long',
      severity: 'warning',
      field: 'description',
      title: 'Description is too long for Google',
      detail: `${len} characters; Google shows about ${google.description.visible.length}. Keep it under 155.`,
      fix: 'metadata',
    });
  } else if (len < 70) {
    out.push({
      id: 'description-short',
      severity: 'warning',
      field: 'description',
      title: 'Description is short',
      detail: `${len} characters. 120–155 gives searchers and readers a reason to click.`,
      fix: 'ai',
    });
  } else if (description.source !== 'paragraph') {
    out.push({
      id: 'description-fits', severity: 'pass', field: 'description', title: `Description length is good (${len} characters)`,
    });
  }
  if (normalize(description.value).toLowerCase() === normalize(page.title.value).toLowerCase()) {
    out.push({
      id: 'description-same',
      severity: 'warning',
      field: 'description',
      title: 'Description repeats the title',
      detail: 'Use the description to add something the title does not say.',
      fix: 'ai',
    });
  }
}

function imageChecks(page, images, layouts, out) {
  const { image, imageAlt } = page;
  const url = page.og.image;
  const info = images?.get(url);
  if (image.source === 'default' || image.src === DEFAULT_IMAGE) {
    out.push({
      id: 'image-missing',
      severity: 'error',
      field: 'image',
      title: 'No share image',
      detail: `The page has no image, so EDS falls back to ${DEFAULT_IMAGE}${info && !info.ok ? ', which does not exist' : ''}. Shares get a blank card.`,
      fix: 'metadata',
    });
  } else if (info && !info.ok) {
    out.push({
      id: 'image-broken',
      severity: 'error',
      field: 'image',
      title: 'Share image does not load',
      detail: `${image.src} could not be loaded.`,
      fix: 'metadata',
    });
  }
  if (isSvg(url)) {
    out.push({
      id: 'image-svg',
      severity: 'error',
      field: 'image',
      title: 'SVG share images are not supported',
      detail: 'Facebook, LinkedIn, X and Slack ignore SVG. Use a JPG or PNG.',
      fix: 'metadata',
    });
  }
  if (info?.ok) {
    const { width, height } = info;
    const thumbs = layouts.filter((l) => l.image.mode === 'thumb');
    if (thumbs.length) {
      out.push({
        id: 'image-small',
        severity: 'warning',
        field: 'image',
        title: `Image is too small for a large card (${width}×${height})`,
        detail: `${names(thumbs)} show a small thumbnail instead. Use at least 1200×630.`,
        platforms: thumbs.map((l) => l.platform.id),
        fix: 'metadata',
      });
    } else if (width < 1200) {
      out.push({
        id: 'image-soft',
        severity: 'info',
        field: 'image',
        title: `Image is ${width}px wide`,
        detail: 'It will look soft on high-resolution screens. 1200×630 is the common recommendation.',
        fix: 'metadata',
      });
    }
    const ratio = width / height;
    const cropped = layouts.filter((l) => l.image.cropPct > 10);
    if (Math.abs(ratio - IDEAL_RATIO) / IDEAL_RATIO > 0.1 && cropped.length) {
      const worst = Math.max(...cropped.map((l) => l.image.cropPct));
      out.push({
        id: 'image-ratio',
        severity: 'warning',
        field: 'image',
        title: `Cards crop ${worst}% of the image`,
        detail: `The image is ${ratio.toFixed(2)}:1; link cards are about 1.91:1. ${names(cropped)} cut off the ${cropped[0].image.cropAxis === 'height' ? 'top and bottom' : 'sides'}.`,
        platforms: cropped.map((l) => l.platform.id),
        fix: 'metadata',
      });
    } else if (!thumbs.length && width >= 1200) {
      out.push({
        id: 'image-good', severity: 'pass', field: 'image', title: `Image is ${width}×${height}, a good fit for cards`,
      });
    }
  }
  if (image.source !== 'default') {
    if (!imageAlt.value) {
      out.push({
        id: 'image-alt-missing',
        severity: 'warning',
        field: 'image-alt',
        title: 'Share image has no alt text',
        detail: 'Screen reader users hear nothing for the card image. Add Image Alt.',
        fix: 'metadata',
      });
    } else if (image.source === 'metadata' && imageAlt.source === 'content') {
      out.push({
        id: 'image-alt-mismatch',
        severity: 'info',
        field: 'image-alt',
        title: 'Image alt may describe a different image',
        detail: 'The alt text comes from the first image on the page, not the Metadata image.',
        fix: 'metadata',
      });
    } else {
      out.push({
        id: 'image-alt-ok', severity: 'pass', field: 'image-alt', title: 'Share image has alt text',
      });
    }
  }
}

function duplicateChecks(page, entries, out) {
  if (!entries.length) return;
  const titles = findDuplicates(page.title.full, entries, 'title');
  if (titles.length) {
    out.push({
      id: 'title-duplicate',
      severity: 'warning',
      field: 'title',
      title: 'Another page has the same title',
      detail: `Also used by ${titles.slice(0, 3).join(', ')}. Search engines may treat them as duplicates.`,
      paths: titles,
      fix: 'metadata',
    });
  }
  const descriptions = findDuplicates(page.description.value, entries, 'description');
  if (descriptions.length) {
    out.push({
      id: 'description-duplicate',
      severity: 'warning',
      field: 'description',
      title: 'Another page has the same description',
      detail: `Also used by ${descriptions.slice(0, 3).join(', ')}.`,
      paths: descriptions,
      fix: 'metadata',
    });
  }
  if (!titles.length && !descriptions.length) {
    out.push({
      id: 'unique', severity: 'pass', field: 'title', title: `Title and description are unique across ${entries.length} pages`,
    });
  }
}

function pageChecks(page, out) {
  if (!page.h1s.length) {
    out.push({
      id: 'h1-missing',
      severity: 'warning',
      field: 'content',
      title: 'Page has no H1',
      detail: 'Every page should have one main heading.',
    });
  } else if (page.h1s.length > 1) {
    out.push({
      id: 'h1-multiple',
      severity: 'info',
      field: 'content',
      title: `Page has ${page.h1s.length} H1 headings`,
      detail: 'Use one H1 and H2–H6 for the rest.',
    });
  }
  if (page.metadataBlockCount > 1) {
    out.push({
      id: 'metadata-multiple',
      severity: 'warning',
      field: 'metadata',
      title: `${page.metadataBlockCount} Metadata blocks`,
      detail: 'Only the first one is used. Merge them into one.',
    });
  }
  if (/noindex/i.test(page.robots)) {
    out.push({
      id: 'noindex',
      severity: 'warning',
      field: 'robots',
      title: 'Page is hidden from search (noindex)',
      detail: 'The Robots metadata tells search engines not to index this page.',
    });
  }
  if (!page.og.siteName) {
    out.push({
      id: 'site-name',
      severity: 'info',
      field: 'og:site_name',
      title: 'No site name',
      detail: 'Slack and Facebook show the domain instead of your brand. Add og:site_name once in bulk metadata.',
    });
  }
}

/**
 * @param {object} page result of extractPage
 * @param {object} opts
 * @param {Map} opts.images image info keyed by URL ({ ok, width, height })
 * @param {Array|object} opts.index query-index rows, or the query-index.json response
 */
export function runChecks(page, { images = new Map(), index = null } = {}) {
  const layouts = layoutAll(page, images);
  const out = [];
  titleChecks(page, layouts, out);
  descriptionChecks(page, layouts, out);
  imageChecks(page, images, layouts.filter((l) => l.platform.image), out);
  duplicateChecks(page, indexEntries(index, page.path), out);
  pageChecks(page, out);
  out.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity));
  const counts = {};
  SEVERITY.forEach((s) => { counts[s] = out.filter((c) => c.severity === s).length; });
  const score = Math.max(0, 100 - out.reduce((sum, c) => sum + PENALTY[c.severity], 0));
  return {
    checks: out, counts, score, layouts,
  };
}

export function platformIssues(checks, platformId) {
  return checks.filter((c) => c.platforms?.includes(platformId));
}
