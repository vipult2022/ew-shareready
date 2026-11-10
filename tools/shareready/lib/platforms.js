import { fitText } from './measure.js';

const SANS = 'Helvetica, Arial, sans-serif';

/**
 * How each destination renders a shared link. `width` is the preview frame; text
 * widths are the space inside it. Widths, fonts and line limits are
 * approximations of each platform's desktop UI (checked Nov 2026); they change over
 * time, so treat results as a strong hint rather than a guarantee.
 */
export const PLATFORMS = [
  {
    id: 'google',
    label: 'Google',
    short: 'G',
    source: 'html',
    width: 632,
    title: { font: `400 20px Arial, ${SANS}`, maxPx: 600 },
    description: { font: `400 14px Arial, ${SANS}`, maxPx: 990 },
  },
  {
    id: 'google-mobile',
    label: 'Google mobile',
    short: 'G',
    source: 'html',
    width: 360,
    title: { font: `400 18px Arial, ${SANS}`, width: 312, lines: 2 },
    description: { font: `400 14px Arial, ${SANS}`, maxPx: 680 },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    short: 'in',
    source: 'og',
    width: 552,
    image: { ratio: 1.91, minWidth: 401, recommended: '1200×627' },
    title: { font: `600 14px ${SANS}`, width: 520, lines: 2 },
  },
  {
    id: 'facebook',
    label: 'Facebook',
    short: 'f',
    source: 'og',
    width: 500,
    image: {
      ratio: 1.91, minWidth: 600, minHeight: 315, recommended: '1200×630',
    },
    title: { font: `600 17px ${SANS}`, width: 468, lines: 2 },
    description: { font: `400 15px ${SANS}`, width: 468, lines: 1 },
  },
  {
    id: 'x',
    label: 'X',
    short: 'X',
    source: 'twitter',
    width: 506,
    image: { ratio: 2, minWidth: 300, recommended: '1200×600' },
    title: { font: `400 13px ${SANS}`, width: 430, lines: 1 },
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    short: 'W',
    source: 'og',
    width: 340,
    image: { ratio: 1.91, minWidth: 300, recommended: '1200×630' },
    title: { font: `600 14px ${SANS}`, width: 296, lines: 2 },
    description: { font: `400 13px ${SANS}`, width: 296, lines: 2 },
  },
  {
    id: 'slack',
    label: 'Slack',
    short: 'S',
    source: 'og',
    width: 544,
    image: { crop: false, minWidth: 1 },
    title: { font: `700 15px ${SANS}`, width: 460, lines: 2 },
    description: { font: `400 15px ${SANS}`, width: 460, lines: 3 },
  },
  {
    id: 'teams',
    label: 'Teams',
    short: 'T',
    source: 'og',
    width: 420,
    image: { ratio: 1.91, minWidth: 400, recommended: '1200×630' },
    title: { font: `600 14px "Segoe UI", ${SANS}`, width: 370, lines: 2 },
    description: { font: `400 14px "Segoe UI", ${SANS}`, width: 370, lines: 2 },
  },
];

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id);
}

export function platformValues(page, platform) {
  if (platform.source === 'html') {
    return { title: page.htmlTitle, description: page.description.value, image: '' };
  }
  const src = platform.source === 'twitter' ? page.twitter : page.og;
  return {
    title: src.title,
    description: src.description,
    image: src.image,
    siteName: page.og.siteName,
  };
}

/**
 * How an image of the given size is shown: as a large cropped card, a small thumbnail,
 * or not at all. cropPct is the share of the image hidden by the crop.
 */
export function imageLayout(platform, info) {
  const spec = platform.image;
  if (!spec) return { mode: 'none' };
  if (!info?.ok) return { mode: 'missing' };
  const { width, height } = info;
  if (width < spec.minWidth || (spec.minHeight && height < spec.minHeight)) {
    return { mode: 'thumb', cropPct: 0 };
  }
  if (spec.crop === false || !spec.ratio) return { mode: 'large', cropPct: 0 };
  const ratio = width / height;
  const visible = ratio < spec.ratio ? ratio / spec.ratio : spec.ratio / ratio;
  return {
    mode: 'large',
    cropPct: Math.round((1 - visible) * 100),
    cropAxis: ratio < spec.ratio ? 'height' : 'width',
  };
}

/**
 * @param {Map<string, {ok, width, height}>} images image info keyed by URL
 */
export function layoutPlatform(page, platform, images) {
  const values = platformValues(page, platform);
  return {
    platform,
    values,
    title: platform.title ? fitText(values.title, platform.title) : null,
    description: platform.description ? fitText(values.description, platform.description) : null,
    image: imageLayout(platform, images?.get(values.image)),
  };
}

export function layoutAll(page, images) {
  return PLATFORMS.map((platform) => layoutPlatform(page, platform, images));
}
