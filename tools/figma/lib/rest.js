/**
 * "Paste a Figma link": reads a link to a frame, and turns the frame Figma's REST API returns
 * (GET /v1/files/:key/nodes) into the same layer tree the Figma plugin sends, so the panel
 * treats both the same way. No network calls here; the worker makes them.
 */

const SHAPES = ['RECTANGLE', 'ELLIPSE', 'REGULAR_POLYGON', 'STAR'];
const CONTAINERS = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'];
const ICONS = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'LINE'];
const FILE_KEY = /^[A-Za-z0-9]{10,64}$/;
const NODE_ID = /^I?\d+:\d+(;I?\d+:\d+)*$/;
const FIGMA_HOSTS = ['figma.com', 'www.figma.com'];
const MAX_LAYERS = 3000;
const HOW = 'In Figma, right-click the frame and choose Copy/Paste as › Copy link to selection.';

export class LinkError extends Error {}

/** { fileKey, nodeId, url } from a figma.com link to one frame. */
export function parseFigmaLink(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new LinkError(`Paste a link to a Figma frame. ${HOW}`);
  }
  if (url.protocol !== 'https:' || !FIGMA_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new LinkError(`That is not a figma.com link. ${HOW}`);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (!['design', 'file', 'proto'].includes(parts[0]) || !parts[1]) {
    throw new LinkError(`That link is not to a Figma design file. ${HOW}`);
  }
  const fileKey = parts[2] === 'branch' && parts[3] ? parts[3] : parts[1];
  if (!FILE_KEY.test(fileKey)) throw new LinkError('That Figma link looks cut off. Copy it again.');
  const raw = url.searchParams.get('node-id') || '';
  if (!raw) throw new LinkError(`That link is to the whole file, not one frame. ${HOW}`);
  const nodeId = raw.replace(/-/g, ':');
  if (!NODE_ID.test(nodeId)) throw new LinkError('That Figma link does not point to a frame. Copy it again.');
  return {
    fileKey,
    nodeId,
    url: `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, '-')}`,
  };
}

const hex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
const colorHex = (c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;

/** The same picture id the plugin uses, so a frame sent both ways keeps its pictures. */
export const pictureId = (nodeId) => `n${String(nodeId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '').slice(0, 60);

function visibleFills(node) {
  const { fills } = node;
  if (!Array.isArray(fills)) return [];
  return fills.filter((f) => f && f.visible !== false
    && (f.opacity === undefined || f.opacity > 0));
}

const imageFill = (node) => visibleFills(node).find((f) => f.type === 'IMAGE' && f.imageRef);
const solidFill = (node) => visibleFills(node).find((f) => f.type === 'SOLID' && f.color);
const urlOf = (link) => (link && link.type === 'URL' && typeof link.url === 'string' ? link.url : '');

function box(node, origin) {
  const b = node.absoluteBoundingBox || {
    x: origin.x, y: origin.y, width: 0, height: 0,
  };
  return {
    x: Math.round(b.x - origin.x),
    y: Math.round(b.y - origin.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

/** The size most of the text is set in, and the first link in it. */
function textStyle(node) {
  const base = node.style || {};
  const table = node.styleOverrideTable || {};
  const overrides = Array.isArray(node.characterStyleOverrides) ? node.characterStyleOverrides : [];
  const sizes = new Map();
  let link = urlOf(base.hyperlink);
  const { length } = String(node.characters || '');
  for (let i = 0; i < length; i += 1) {
    const style = (overrides[i] && table[overrides[i]]) || {};
    const size = style.fontSize || base.fontSize || 0;
    sizes.set(size, (sizes.get(size) || 0) + 1);
    if (!link) link = urlOf(style.hyperlink);
  }
  const [[size] = [base.fontSize]] = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  const fill = solidFill(node);
  return {
    size: Math.round(size || 16),
    weight: Number(base.fontWeight) >= 600 ? 700 : 400,
    color: fill ? colorHex(fill.color) : '',
    link,
  };
}

function simplify(node, ctx, origin) {
  if (!node || node.visible === false) return null;
  ctx.count += 1;
  if (ctx.count > MAX_LAYERS) {
    ctx.truncated = true;
    return null;
  }
  const base = { id: node.id, name: node.name || '', ...box(node, origin) };
  if (node.type === 'TEXT') {
    const text = String(node.characters || '').trim();
    return text ? {
      type: 'TEXT', ...base, text, ...textStyle(node),
    } : null;
  }
  const picture = imageFill(node);
  if (SHAPES.includes(node.type) && picture) {
    const id = pictureId(node.id);
    ctx.pictures.push({ id, ref: picture.imageRef, name: node.name || '' });
    return { type: 'IMAGE', ...base, image: id };
  }
  if (CONTAINERS.includes(node.type)) {
    const solid = solidFill(node);
    const out = {
      type: 'FRAME',
      ...base,
      layout: node.layoutMode && node.layoutMode !== 'NONE' ? node.layoutMode : 'NONE',
      filled: !!solid || !!picture,
      fill: solid ? colorHex(solid.color) : '',
      image: '',
      children: [],
    };
    if (picture) {
      const id = pictureId(node.id);
      ctx.pictures.push({ id, ref: picture.imageRef, name: node.name || '' });
      out.image = id;
      out.imageName = '';
    }
    (node.children || []).forEach((child) => {
      const simple = simplify(child, ctx, origin);
      if (simple) out.children.push(simple);
    });
    return out;
  }
  if (ICONS.includes(node.type)) ctx.skipped += 1;
  return null;
}

/**
 * The frame's layer tree and the pictures it needs ({ id, ref, name }, ref being Figma's
 * imageRef). Throws LinkError when the link is not to a frame.
 */
export function fromRest(node) {
  if (!node || typeof node !== 'object') {
    throw new LinkError('That frame is not in the Figma file anymore. Copy the link again.');
  }
  if (node.type === 'CANVAS' || node.type === 'DOCUMENT') {
    throw new LinkError('That link is to a whole Figma page. Link to the one frame that holds the page design.');
  }
  if (!CONTAINERS.includes(node.type)) {
    throw new LinkError('That link is to a single layer. Link to the frame that holds the page design.');
  }
  if (node.visible === false) throw new LinkError('That frame is hidden in Figma. Show it, then try again.');
  const ctx = {
    count: 0, pictures: [], skipped: 0, truncated: false,
  };
  const origin = node.absoluteBoundingBox || {
    x: 0, y: 0, width: 0, height: 0,
  };
  const tree = simplify(node, ctx, origin);
  return {
    name: node.name || '',
    tree,
    pictures: ctx.pictures,
    width: Math.round(origin.width || 0),
    height: Math.round(origin.height || 0),
    skipped: ctx.skipped,
    truncated: ctx.truncated,
  };
}

/** Leaves out pictures that could not be brought in, so nothing points at a missing file. */
export function dropPictures(tree, missing) {
  if (!tree || !missing.size) return tree;
  const walk = (node) => {
    if (node.type === 'FRAME' && missing.has(node.image)) node.image = '';
    if (!Array.isArray(node.children)) return;
    node.children = node.children.filter((c) => !(c.type === 'IMAGE' && missing.has(c.image)));
    node.children.forEach(walk);
  };
  walk(tree);
  return tree;
}
