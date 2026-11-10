/**
 * Works out the metadata a page will publish with, following the same rules as the
 * Edge Delivery Services HTML pipeline (adobe/helix-html-pipeline, extract-metadata.js):
 * - values from the first Metadata block win (bulk metadata is applied underneath)
 * - title falls back to the first H1, then to the first heading
 * - description falls back to the first paragraph with 10+ words, cut to 25 words + " ..."
 * - image falls back to the first image (or image link), then /default-meta-image.png
 * - twitter:* falls back to og:*, og:* falls back to title/description/image
 */

export const DEFAULT_IMAGE = '/default-meta-image.png';

const IMAGE_EXTENSIONS = new Set(['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'svg']);
const FIXED = new Set(['title', 'description', 'image', 'image-alt', 'url', 'twitter:card', 'og:url', 'canonical']);
const ELEMENT = 1;
const TEXT = 3;

export function toMetaName(label) {
  const name = String(label || '').trim().replace(/[^0-9a-zA-Z:_-]/g, '-');
  const lower = name.toLowerCase();
  if (lower.startsWith('hreflang-') || lower.startsWith('hreflang:')) {
    return `hreflang:${name.substring(9)}`;
  }
  return lower;
}

export function parseHtml(html, Parser = DOMParser) {
  return new Parser().parseFromString(html || '', 'text/html');
}

function text(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function childNodes(el) {
  return [...el.childNodes].filter((n) => n.nodeType === ELEMENT
    || (n.nodeType === TEXT && n.textContent.trim()));
}

function isImageHref(href) {
  try {
    const { pathname } = new URL(href, 'https://localhost/');
    const ext = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function readCellValue(name, cell) {
  if (name === 'json-ld') return text(cell);
  const nodes = childNodes(cell);
  const [first] = nodes;
  let value = '';
  if (first?.nodeType === ELEMENT) {
    const tag = first.tagName.toLowerCase();
    let list;
    if (tag === 'p') list = nodes;
    else if (tag === 'ul' || tag === 'ol') list = childNodes(first);
    if (list) value = list.map((n) => text(n)).filter(Boolean).join(', ');
  }
  if (!value) value = text(cell);
  if (!value) value = cell.querySelector('a')?.getAttribute('href') || '';
  if (!value) value = cell.querySelector('img')?.getAttribute('src') || '';
  return value;
}

/**
 * Reads a Metadata block into rows, keeping the original label and cell so the
 * panel can show where a value comes from and rebuild the block on Fix.
 */
export function readBlockRows(block) {
  if (!block) return [];
  return [...block.children].reduce((rows, row) => {
    const [keyCell, valueCell] = row.children;
    if (!valueCell) return rows;
    const label = text(keyCell);
    const name = toMetaName(label);
    if (!name) return rows;
    const img = valueCell.querySelector('img');
    rows.push({
      label,
      name,
      value: readCellValue(name, valueCell),
      imageSrc: img?.getAttribute('src') || '',
      imageAlt: img?.getAttribute('alt') || '',
      html: valueCell.innerHTML,
    });
    return rows;
  }, []);
}

function findMetadataBlocks(root) {
  return [...root.querySelectorAll('div.metadata')];
}

function isBlock(el) {
  return el.tagName === 'DIV' && el.classList.length > 0;
}

function describe(words) {
  return `${words.slice(0, 25).join(' ')}${words.length > 25 ? ' ...' : ''}`;
}

function extractDescription(root, skip) {
  const candidates = [...root.querySelectorAll('p')]
    .filter((p) => p.parentElement?.tagName === 'DIV' && !skip(p));
  let result = null;
  candidates.some((p) => {
    const words = (p.textContent || '').trim().split(/\s+/);
    if (words.length >= 10 || words.some((w) => w.length > 25 && !w.startsWith('http'))) {
      result = { value: describe(words), truncated: words.length > 25, from: p };
      return true;
    }
    return false;
  });
  return result;
}

function findHeroImage(root, skip) {
  const hero = [...root.querySelectorAll('div img, div a[href]')]
    .filter((el) => !skip(el))
    .find((el) => el.tagName === 'IMG' || isImageHref(el.getAttribute('href')));
  if (!hero) return null;
  if (hero.tagName === 'A') {
    const href = hero.getAttribute('href');
    const label = text(hero);
    return { src: href, alt: hero.getAttribute('title') || (label && label !== href ? label : '') };
  }
  return { src: hero.getAttribute('src'), alt: hero.getAttribute('alt') || '' };
}

function collectImages(root, skip) {
  return [...root.querySelectorAll('img')]
    .filter((img) => !skip(img) && img.getAttribute('src'))
    .map((img) => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' }))
    .filter((img, i, all) => all.findIndex((o) => o.src === img.src) === i)
    .slice(0, 8);
}

function collectParagraphs(root, skip) {
  return [...root.querySelectorAll('p')]
    .filter((p) => !skip(p))
    .map((p) => text(p))
    .filter((t) => t.split(' ').length >= 4);
}

export function pagePathname(path = '/') {
  let p = `/${String(path).replace(/^\/+/, '')}`;
  p = p.replace(/\.html$/, '');
  if (p === '/index') return '/';
  if (p.endsWith('/index')) p = p.slice(0, -5);
  return p;
}

function resolveAgainst(src, base) {
  if (!src) return '';
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}

/**
 * @param {Document} doc parsed draft (DA source HTML or EW live document HTML)
 * @param {object} opts
 * @param {string} opts.path page path, e.g. /offers/spring-savings
 * @param {string} opts.host production host shown in previews, e.g. www.example.com
 * @param {string} opts.assetBase origin used to resolve relative image paths
 * @param {object} opts.bulk bulk metadata (name -> value) applying to this path
 */
export function extractPage(doc, opts = {}) {
  const { path = '/', host = 'localhost', bulk = {} } = opts;
  const root = doc.querySelector('main') || doc.body;
  const metaBlocks = findMetadataBlocks(root);
  const [metaBlock] = metaBlocks;
  const skip = (el) => !!(metaBlock && metaBlock.contains(el));
  const rows = readBlockRows(metaBlock);

  const metaConfig = {};
  const sources = {};
  Object.entries(bulk || {}).forEach(([name, value]) => {
    if (!value) return;
    metaConfig[name] = value === '""' ? undefined : value;
    sources[name] = 'bulk';
  });
  rows.forEach(({ name, value }) => {
    if (value || FIXED.has(name)) {
      metaConfig[name] = value;
      sources[name] = 'metadata';
    }
  });

  const pathname = pagePathname(path);
  const url = `https://${host}${pathname}`;
  const assetBase = opts.assetBase || `https://${host}`;
  const h1s = [...root.querySelectorAll('h1')].filter((el) => !skip(el)).map(text);
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((el) => !skip(el)).map((el) => ({ level: Number(el.tagName[1]), text: text(el) }));

  // Title
  let title;
  if ('title' in metaConfig) {
    title = { value: metaConfig.title || '', source: metaConfig.title ? sources.title : 'empty' };
  } else if (h1s.length) {
    title = { value: h1s[0], source: 'h1' };
  } else if (headings.length) {
    title = { value: headings[0].text, source: 'heading' };
  } else {
    title = { value: '', source: 'none' };
  }
  const suffix = metaConfig['title:suffix'];
  const htmlSuffix = metaConfig['html-title:suffix'];
  const fullTitle = title.value && suffix && suffix !== '""' ? `${title.value} ${suffix}` : title.value;
  const htmlTitle = fullTitle && htmlSuffix && htmlSuffix !== '""' ? `${fullTitle} ${htmlSuffix}` : fullTitle;

  // Description
  let description;
  if ('description' in metaConfig) {
    description = {
      value: metaConfig.description || '',
      source: metaConfig.description ? sources.description : 'empty',
    };
  } else {
    const auto = extractDescription(root, skip);
    description = auto
      ? { value: auto.value, source: 'paragraph', truncated: auto.truncated }
      : { value: '', source: 'none' };
  }

  // Image
  const hero = findHeroImage(root, skip);
  let image;
  if ('image' in metaConfig && metaConfig.image) {
    const row = rows.find((r) => r.name === 'image');
    image = { src: metaConfig.image, source: sources.image, alt: row?.imageAlt || '' };
  } else if (hero) {
    image = { src: hero.src, source: 'content', alt: hero.alt };
  } else {
    image = { src: DEFAULT_IMAGE, source: 'default', alt: '' };
  }
  image.url = resolveAgainst(image.src, `${assetBase}${pathname}`);

  let imageAlt;
  if ('image-alt' in metaConfig) {
    imageAlt = { value: metaConfig['image-alt'] || '', source: sources['image-alt'] };
  } else if (hero?.alt) {
    imageAlt = { value: hero.alt, source: 'content' };
  } else {
    imageAlt = { value: '', source: 'none' };
  }

  const ogTitle = metaConfig['og:title'] ?? fullTitle;
  const ogDescription = metaConfig['og:description'] ?? description.value;
  const ogImageSrc = metaConfig['og:image'];
  const og = {
    title: ogTitle,
    description: ogDescription,
    image: ogImageSrc ? resolveAgainst(ogImageSrc, `${assetBase}${pathname}`) : image.url,
    imageAlt: metaConfig['og:image:alt'] ?? imageAlt.value,
    siteName: metaConfig['og:site_name'] || '',
    url: metaConfig.canonical || url,
  };
  const twImage = metaConfig['twitter:image'];
  const twitter = {
    card: metaConfig['twitter:card'] || 'summary_large_image',
    title: metaConfig['twitter:title'] || og.title,
    description: metaConfig['twitter:description'] || og.description,
    image: twImage ? resolveAgainst(twImage, `${assetBase}${pathname}`) : og.image,
    site: metaConfig['twitter:site'] || '',
  };

  return {
    path: pathname,
    url,
    host,
    rows,
    metaConfig,
    hasMetadataBlock: !!metaBlock,
    metadataBlockCount: metaBlocks.length,
    title: { ...title, full: fullTitle },
    htmlTitle,
    description,
    image,
    imageAlt,
    og,
    twitter,
    robots: metaConfig.robots || '',
    canonical: metaConfig.canonical || '',
    h1s,
    headings,
    images: collectImages(root, skip).map((img) => ({
      ...img,
      url: resolveAgainst(img.src, `${assetBase}${pathname}`),
    })),
    paragraphs: collectParagraphs(root, skip),
    hasBlocks: [...root.querySelectorAll('div')].some(isBlock),
  };
}
