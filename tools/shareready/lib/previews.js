import { h } from './dom.js';

/**
 * Lookalike link previews. They are deliberately generic (no platform logos) and are
 * rendered at each platform's native width; the panel scales them to fit.
 */

function initial(text) {
  return (text || '?').trim().charAt(0).toUpperCase() || '?';
}

function breadcrumb(page) {
  const segments = page.path.split('/').filter(Boolean);
  return [`https://${page.host}`, ...segments].join(' › ');
}

function cardImage(layout, opts, className) {
  const { image } = layout;
  const url = layout.values.image;
  if (image.mode === 'none') return null;
  if (image.mode === 'missing' || !url) {
    return h('div', { class: `${className} sr-img-missing` }, h('span', {}, 'No image'));
  }
  return h(
    'div',
    { class: className, dataset: { crop: image.cropPct > 10 ? String(image.cropPct) : '' } },
    h('img', { src: opts.src(url), alt: '', loading: 'lazy' }),
  );
}

function clamp(text, lines, className, tag = 'div') {
  return h(tag, { class: `${className} sr-clamp`, style: { '--lines': String(lines) } }, text || '');
}

let flagged = null;

function cutMark(field) {
  if (!field?.truncated) return null;
  const issue = !flagged || flagged.has(field.name);
  return h('span', {
    class: `sr-cut${issue ? '' : ' sr-cut-ok'}`,
    title: issue ? 'Cut off here' : 'Cut off here, which is normal on this platform',
  }, '✂');
}

function google(layout, page) {
  const siteName = layout.values.siteName || page.og.siteName || page.host;
  return h(
    'div',
    { class: 'sr-google' },
    h(
      'div',
      { class: 'sr-g-site' },
      h('span', { class: 'sr-favicon' }, initial(siteName)),
      h('div', {}, h('div', { class: 'sr-g-name' }, siteName), h('div', { class: 'sr-g-url' }, breadcrumb(page))),
    ),
    h('div', { class: 'sr-g-title' }, layout.title.lines.map((l, i, all) => h('div', {}, l, i === all.length - 1 ? cutMark({ ...layout.title, name: 'title' }) : null))),
    h(
      'div',
      { class: 'sr-g-desc' },
      layout.description.text || h('span', { class: 'sr-empty' }, 'Google will pick text from the page'),
      cutMark({ ...layout.description, name: 'description' }),
    ),
  );
}

function linkedin(layout, page, opts) {
  const thumb = layout.image.mode === 'thumb';
  return h(
    'div',
    { class: 'sr-post' },
    h('div', { class: 'sr-post-head' }, h('span', { class: 'sr-avatar' }, initial(opts.brand)), h('div', {}, h('b', {}, opts.brand), h('small', {}, '1h • Edited'))),
    h('p', { class: 'sr-post-text' }, opts.postText),
    h(
      'div',
      { class: `sr-li-card${thumb ? ' sr-thumb' : ''}` },
      cardImage(layout, opts, 'sr-li-img'),
      h('div', { class: 'sr-li-body' }, clamp(layout.values.title, 2, 'sr-li-title'), h('div', { class: 'sr-li-host' }, page.host), cutMark({ ...layout.title, name: 'title' })),
    ),
  );
}

function facebook(layout, page, opts) {
  const thumb = layout.image.mode === 'thumb';
  return h(
    'div',
    { class: 'sr-post sr-fb' },
    h('div', { class: 'sr-post-head' }, h('span', { class: 'sr-avatar' }, initial(opts.brand)), h('div', {}, h('b', {}, opts.brand), h('small', {}, 'Just now'))),
    h('p', { class: 'sr-post-text' }, opts.postText),
    h(
      'div',
      { class: `sr-fb-card${thumb ? ' sr-thumb' : ''}` },
      cardImage(layout, opts, 'sr-fb-img'),
      h(
        'div',
        { class: 'sr-fb-body' },
        h('div', { class: 'sr-fb-host' }, page.host.toUpperCase()),
        clamp(layout.values.title, 2, 'sr-fb-title'),
        clamp(layout.values.description, 1, 'sr-fb-desc'),
        cutMark({ ...layout.title, name: 'title' }),
      ),
    ),
  );
}

function x(layout, page, opts) {
  const small = layout.image.mode === 'thumb' || page.twitter.card === 'summary';
  return h(
    'div',
    { class: 'sr-post sr-x' },
    h('div', { class: 'sr-post-head' }, h('span', { class: 'sr-avatar' }, initial(opts.brand)), h('div', {}, h('b', {}, opts.brand), h('small', {}, `@${opts.handle} · 1m`))),
    h('p', { class: 'sr-post-text' }, opts.postText),
    small
      ? h(
        'div',
        { class: 'sr-x-card sr-thumb' },
        cardImage(layout, opts, 'sr-x-img'),
        h('div', { class: 'sr-x-body' }, h('div', { class: 'sr-x-host' }, page.host), clamp(layout.values.title, 1, 'sr-x-title-plain'), clamp(layout.values.description, 2, 'sr-x-desc')),
      )
      : h(
        'div',
        { class: 'sr-x-card' },
        cardImage(layout, opts, 'sr-x-img'),
        h('div', { class: 'sr-x-pill sr-clamp', style: { '--lines': '1' } }, layout.values.title || ''),
      ),
    small ? null : h('div', { class: 'sr-x-from' }, `From ${page.host}`),
  );
}

function whatsapp(layout, page, opts) {
  const large = layout.image.mode === 'large';
  return h(
    'div',
    { class: 'sr-chat sr-wa' },
    h(
      'div',
      { class: 'sr-wa-bubble' },
      h(
        'div',
        { class: `sr-wa-card${large ? '' : ' sr-thumb'}` },
        cardImage(layout, opts, 'sr-wa-img'),
        h('div', { class: 'sr-wa-body' }, clamp(layout.values.title, 2, 'sr-wa-title'), clamp(layout.values.description, 2, 'sr-wa-desc'), h('div', { class: 'sr-wa-host' }, page.host)),
      ),
      h('div', { class: 'sr-wa-link' }, opts.shareUrl),
      h('div', { class: 'sr-wa-time' }, '09:41 ✓✓'),
    ),
  );
}

function slack(layout, page, opts) {
  const siteName = layout.values.siteName || page.host;
  return h(
    'div',
    { class: 'sr-chat sr-slack' },
    h('span', { class: 'sr-avatar sr-square' }, initial(opts.brand)),
    h(
      'div',
      { class: 'sr-slack-msg' },
      h('div', {}, h('b', {}, opts.brand), h('small', {}, ' 9:41 AM')),
      h('div', { class: 'sr-slack-link' }, opts.shareUrl),
      h(
        'div',
        { class: 'sr-slack-unfurl' },
        h('div', { class: 'sr-slack-site' }, h('span', { class: 'sr-favicon sr-tiny' }, initial(siteName)), siteName),
        clamp(layout.values.title, 2, 'sr-slack-title'),
        clamp(layout.values.description, 3, 'sr-slack-desc'),
        cardImage(layout, opts, 'sr-slack-img'),
      ),
    ),
  );
}

function teams(layout, page, opts) {
  return h(
    'div',
    { class: 'sr-chat sr-teams' },
    h('div', { class: 'sr-teams-meta' }, h('b', {}, opts.brand), h('small', {}, ' 9:41 AM')),
    h('div', { class: 'sr-teams-link' }, opts.shareUrl),
    h(
      'div',
      { class: 'sr-teams-card' },
      cardImage(layout, opts, 'sr-teams-img'),
      h('div', { class: 'sr-teams-body' }, clamp(layout.values.title, 2, 'sr-teams-title'), clamp(layout.values.description, 2, 'sr-teams-desc'), h('div', { class: 'sr-teams-host' }, page.host)),
    ),
  );
}

const RENDERERS = {
  google,
  'google-mobile': google,
  linkedin,
  facebook,
  x,
  whatsapp,
  slack,
  teams,
};

/**
 * @param {object} layout result of layoutPlatform
 * @param {object} page result of extractPage
 * @param {object} options
 * @param {(url: string) => string} options.src maps an image URL to a displayable one
 * @param {string} options.brand name shown as the poster
 * @param {Set<string>} [options.flagged] fields with an issue here; other cut marks are muted
 */
export function renderPreview(layout, page, options = {}) {
  const brand = options.brand || page.og.siteName || page.host;
  const opts = {
    src: (url) => url,
    handle: brand.toLowerCase().replace(/[^a-z0-9]+/g, ''),
    postText: 'Fresh on our site 👇',
    shareUrl: page.url,
    ...options,
    brand,
  };
  const render = RENDERERS[layout.platform.id];
  flagged = options.flagged || null;
  const frame = h(
    'div',
    {
      class: `sr-frame sr-frame-${layout.platform.id}`,
      style: { width: `${layout.platform.width}px` },
    },
    render(layout, page, opts),
  );
  return frame;
}

export function platformIds() {
  return Object.keys(RENDERERS);
}
