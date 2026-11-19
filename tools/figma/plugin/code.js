/* global figma, __html__, globalThis */
/**
 * Figma side of the handoff (runs in Figma's plugin sandbox). Reads the selected frame into
 * a small layer tree, exports its pictures and a thumbnail, and hands them to the window
 * (ui.html), which sends them to the team's worker. It can also draw the sample design.
 * Nothing here talks to the network: Figma only lets the window do that.
 */

const STORE = 'ew-handoff-settings';
const SHAPES = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR'];
const CONTAINERS = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'];
const ICONS = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'];
const GENERIC = /^(rectangle|image|img|frame|group|vector|ellipse|photo|picture|pic|layer|mask|bg|background|untitled)?([\s_-]*(\d+|copy))*$/i;
const MAX_LAYERS = 3000;
const THUMB_WIDTH = 800;
const PICTURE_WIDTH = 1600;

const hex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
const colorHex = (c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
const rgb = (value) => {
  const v = String(value || '#000000').replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
};
const pictureId = (nodeId) => `n${String(nodeId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '').slice(0, 60);

function visibleFills(node) {
  const { fills } = node;
  if (!Array.isArray(fills)) return [];
  return fills.filter((f) => f.visible !== false && (f.opacity === undefined || f.opacity > 0));
}

const imageFill = (node) => visibleFills(node).find((f) => f.type === 'IMAGE' && f.imageHash);
const solidFill = (node) => visibleFills(node).find((f) => f.type === 'SOLID');

function box(node, origin) {
  const b = node.absoluteBoundingBox || {
    x: node.x || 0, y: node.y || 0, width: node.width || 0, height: node.height || 0,
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
  let size = typeof node.fontSize === 'number' ? node.fontSize : 0;
  let weight = 400;
  let link = '';
  let color = '';
  const fill = solidFill(node);
  if (fill) color = colorHex(fill.color);
  const font = node.fontName;
  if (font && typeof font === 'object' && /bold|black|heavy|semi/i.test(font.style)) weight = 700;
  const { hyperlink } = node;
  if (hyperlink && typeof hyperlink === 'object' && hyperlink.type === 'URL') link = hyperlink.value;
  if (typeof node.getStyledTextSegments === 'function') {
    const segments = node.getStyledTextSegments(['fontSize', 'hyperlink']);
    const weights = new Map();
    segments.forEach((s) => {
      weights.set(s.fontSize, (weights.get(s.fontSize) || 0) + (s.end - s.start));
    });
    if (!size && weights.size) [[size]] = [...weights.entries()].sort((a, b) => b[1] - a[1]);
    const linked = segments.find((s) => s.hyperlink && s.hyperlink.type === 'URL');
    if (!link && linked) link = linked.hyperlink.value;
  }
  return {
    size: Math.round(size || 16), weight, color, link,
  };
}

/**
 * The selected frame as the layer tree lib/design.js reads. Pictures to export are collected
 * in ctx.pictures ({ id, node, hash, name }).
 */
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
    ctx.pictures.push({
      id, node, name: node.name || '', export: true,
    });
    return { type: 'IMAGE', ...base, image: id };
  }
  if (CONTAINERS.includes(node.type)) {
    const out = {
      type: 'FRAME',
      ...base,
      layout: node.layoutMode && node.layoutMode !== 'NONE' ? node.layoutMode : 'NONE',
      filled: !!solidFill(node) || !!picture,
      fill: solidFill(node) ? colorHex(solidFill(node).color) : '',
      image: '',
      children: [],
    };
    if (picture) {
      const id = pictureId(node.id);
      ctx.pictures.push({
        id, hash: picture.imageHash, name: node.name || '', export: false,
      });
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

function describe(node) {
  if (!node) return { ok: false, reason: 'none' };
  if (!CONTAINERS.includes(node.type)) return { ok: false, reason: 'type', name: node.name };
  const ctx = {
    count: 0, pictures: [], skipped: 0, truncated: false,
  };
  const tree = simplify(node, ctx, node.absoluteBoundingBox || { x: 0, y: 0 });
  let texts = 0;
  const walk = (n) => {
    if (n.type === 'TEXT') texts += 1;
    (n.children || []).forEach(walk);
  };
  if (tree) walk(tree);
  return {
    ok: true,
    id: node.id,
    name: node.name,
    w: Math.round(node.width),
    h: Math.round(node.height),
    texts,
    pictures: ctx.pictures.length,
    unnamed: ctx.pictures.filter((p) => !p.name || GENERIC.test(p.name.trim())).length,
    skipped: ctx.skipped,
    truncated: ctx.truncated,
  };
}

function selected() {
  const { selection } = figma.currentPage;
  return selection.length === 1 ? selection[0] : null;
}

async function exportPicture(pic) {
  if (pic.export) {
    const scale = Math.min(2, PICTURE_WIDTH / Math.max(1, pic.node.width));
    return pic.node.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: scale } });
  }
  const image = figma.getImageByHash(pic.hash);
  return image ? image.getBytesAsync() : null;
}

async function settings() {
  const saved = (await figma.clientStorage.getAsync(STORE)) || {};
  const user = figma.currentUser;
  return { sender: user ? user.name : '', ...saved };
}

async function postSelection() {
  const node = selected();
  const info = describe(node);
  if (info.ok) {
    try {
      const bytes = await node.exportAsync({ format: 'JPG', constraint: { type: 'WIDTH', value: 360 } });
      info.preview = figma.base64Encode(bytes);
    } catch {
      info.preview = '';
    }
  }
  figma.ui.postMessage({ type: 'selection', selection: info });
}

/** Everything /send needs, except the site and key, which the window adds. */
async function buildPayload(options) {
  const node = selected();
  const info = describe(node);
  if (!info.ok) throw new Error('Select one frame to send.');
  const ctx = {
    count: 0, pictures: [], skipped: 0, truncated: false,
  };
  const tree = simplify(node, ctx, node.absoluteBoundingBox || { x: 0, y: 0 });
  const images = {};
  for (let i = 0; i < ctx.pictures.length; i += 1) {
    const pic = ctx.pictures[i];
    figma.ui.postMessage({
      type: 'progress', step: 'pictures', done: i, total: ctx.pictures.length,
    });
    // eslint-disable-next-line no-await-in-loop
    const bytes = await exportPicture(pic);
    if (bytes) images[pic.id] = { name: pic.name, data: figma.base64Encode(bytes) };
  }
  figma.ui.postMessage({ type: 'progress', step: 'thumbnail' });
  const thumb = await node.exportAsync({ format: 'JPG', constraint: { type: 'WIDTH', value: THUMB_WIDTH } });
  return {
    handoff: {
      name: node.name,
      file: figma.root.name,
      fileKey: figma.fileKey || '',
      frame: node.id,
      page: figma.currentPage.name,
      sender: options.sender || '',
      note: options.note || '',
      path: options.path || '',
      width: info.w,
      height: info.h,
      skipped: ctx.skipped,
      tree,
    },
    images,
    thumbnail: figma.base64Encode(thumb),
  };
}

/* The sample design: the same tree the EW panel's demo mode uses, drawn as real layers. */

async function drawText(spec, parent) {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: spec.weight >= 700 ? 'Bold' : 'Regular' };
  t.characters = spec.text;
  t.fontSize = spec.size;
  t.name = spec.name || spec.text.slice(0, 40);
  t.fills = [{ type: 'SOLID', color: rgb(spec.color || '#1d2b3a') }];
  t.textAutoResize = 'HEIGHT';
  t.resize(spec.w, Math.max(1, spec.h));
  if (parent && parent.name && /^Button \//.test(parent.name)) t.textAlignHorizontal = 'CENTER';
  if (spec.link) {
    try {
      t.hyperlink = { type: 'URL', value: spec.link };
    } catch {
      // Figma may refuse relative links; the text still goes in.
    }
  }
  return t;
}

async function draw(spec, images, parent) {
  let node;
  if (spec.type === 'TEXT') node = await drawText(spec, parent);
  else if (spec.type === 'IMAGE') {
    node = figma.createRectangle();
    node.resize(spec.w, spec.h);
    node.cornerRadius = 12;
    node.fills = images[spec.image]
      ? [{ type: 'IMAGE', imageHash: figma.createImage(images[spec.image]).hash, scaleMode: 'FILL' }]
      : [{ type: 'SOLID', color: rgb('#c9d6e2') }];
  } else {
    node = figma.createFrame();
    node.resize(spec.w, spec.h);
    node.cornerRadius = spec.radius || 0;
    const fills = [];
    if (spec.image && images[spec.image]) {
      fills.push({ type: 'IMAGE', imageHash: figma.createImage(images[spec.image]).hash, scaleMode: 'FILL' });
      fills.push({ type: 'SOLID', color: rgb(spec.fill || '#0b2545'), opacity: 0.55 });
    } else if (spec.fill) fills.push({ type: 'SOLID', color: rgb(spec.fill) });
    node.fills = fills;
    if (spec.stroke) {
      node.strokes = [{ type: 'SOLID', color: rgb(spec.stroke) }];
      node.strokeWeight = 2;
    }
    if (spec.layout === 'HORIZONTAL' || spec.layout === 'VERTICAL') {
      node.layoutMode = spec.layout;
      node.itemSpacing = spec.gap || 0;
      node.paddingTop = spec.padding || 0;
      node.paddingBottom = spec.padding || 0;
      node.paddingLeft = spec.padding || 0;
      node.paddingRight = spec.padding || 0;
      node.primaryAxisSizingMode = 'AUTO';
      node.counterAxisSizingMode = 'FIXED';
      if (spec.align === 'CENTER') {
        node.primaryAxisAlignItems = 'CENTER';
        node.counterAxisAlignItems = 'CENTER';
      }
    }
    for (let i = 0; i < (spec.children || []).length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await draw(spec.children[i], images, node);
    }
  }
  node.name = spec.name || node.name;
  if (parent) {
    parent.appendChild(node);
    if (!parent.layoutMode || parent.layoutMode === 'NONE') {
      node.x = spec.x;
      node.y = spec.y;
    }
  }
  return node;
}

async function drawSample(tree, images) {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
  ]);
  const node = await draw(tree, images, null);
  const { center } = figma.viewport;
  node.x = Math.round(center.x - node.width / 2);
  node.y = Math.round(center.y - node.height / 2);
  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  return node;
}

async function onMessage(msg) {
  try {
    if (msg.type === 'ready') {
      figma.ui.postMessage({ type: 'settings', settings: await settings() });
      await postSelection();
    } else if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync(STORE, msg.settings || {});
      figma.ui.postMessage({ type: 'settings', settings: await settings() });
    } else if (msg.type === 'build') {
      figma.ui.postMessage({ type: 'payload', payload: await buildPayload(msg.options || {}) });
    } else if (msg.type === 'sample') {
      await drawSample(msg.tree, msg.images || {});
      figma.notify('Sample design drawn. Select it and send it to Experience Workspace.');
    } else if (msg.type === 'open') {
      if (/^https:\/\//.test(String(msg.url || ''))) figma.openExternal(msg.url);
    } else if (msg.type === 'notify') {
      figma.notify(String(msg.text || ''), { error: !!msg.error });
    } else if (msg.type === 'resize') {
      figma.ui.resize(380, Math.max(420, Math.min(800, Number(msg.height) || 600)));
    }
  } catch (error) {
    figma.ui.postMessage({ type: 'error', text: error.message || String(error) });
  }
}

if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 380, height: 620, themeColors: true });
  figma.ui.onmessage = onMessage;
  figma.on('selectionchange', () => {
    postSelection();
  });
} else {
  // Outside Figma (the tests), hand the helpers over instead.
  globalThis.ewHandoff = { simplify, describe, pictureId };
}
