/**
 * Pixel-accurate text fitting, using canvas measureText in the browser.
 * Search engines and social networks cut titles by rendered width, not characters.
 */

let ctx;
function getContext() {
  if (ctx === undefined) {
    try {
      ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

function fontSize(font) {
  const match = /(\d+(?:\.\d+)?)px/.exec(font || '');
  return match ? Number(match[1]) : 16;
}

const defaultMeasurer = (value, font) => {
  const context = getContext();
  if (context) {
    context.font = font;
    return context.measureText(value).width;
  }
  // Fallback when there is no canvas (e.g. unit tests): average Arial glyph width.
  return value.length * fontSize(font) * 0.46;
};

let measurer = defaultMeasurer;

export function setMeasurer(fn) {
  measurer = fn || defaultMeasurer;
}

export function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function textWidth(value, font) {
  return measurer(value || '', font);
}

function trimToWidth(value, font, maxPx, ellipsis) {
  let out = value;
  while (out && textWidth(`${out}${ellipsis}`, font) > maxPx) {
    const next = out.replace(/\s*\S+$/, '');
    // A single word that is too wide is cut by characters instead.
    out = next === out || !next ? out.slice(0, -1) : next;
  }
  return out.replace(/[\s,;:|–—-]+$/, '');
}

/**
 * Cuts text to fit a single pixel budget, at a word boundary, like Google does.
 */
export function truncateToWidth(value, font, maxPx, ellipsis = ' ...') {
  const clean = normalize(value);
  const width = textWidth(clean, font);
  if (width <= maxPx) {
    return {
      text: clean, lines: [clean], truncated: false, width, max: maxPx,
    };
  }
  const visible = trimToWidth(clean, font, maxPx, ellipsis);
  const shown = `${visible}${ellipsis}`;
  return {
    text: shown, lines: [shown], truncated: true, width, max: maxPx, visible,
  };
}

/**
 * Wraps text into at most maxLines lines of the given width and adds an ellipsis
 * to the last line when it does not fit, like CSS line clamping on social cards.
 */
export function wrapLines(value, font, width, maxLines, ellipsis = '…') {
  const clean = normalize(value);
  const words = clean ? clean.split(' ') : [];
  const lines = [];
  let current = '';
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (!current || textWidth(candidate, font) <= width) {
      current = candidate;
      i += 1;
    } else {
      lines.push(current);
      current = '';
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const truncated = i < words.length;
  if (truncated && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${trimToWidth(lines[last], font, width, ellipsis)}${ellipsis}`;
  }
  return {
    text: lines.join(' '),
    lines,
    truncated,
    width: textWidth(clean, font),
    max: width * maxLines,
    visible: truncated ? lines.join(' ').slice(0, -ellipsis.length) : clean,
  };
}

/**
 * Fits text to a platform field spec: { font, maxPx } or { font, width, lines }.
 */
export function fitText(value, spec) {
  if (!normalize(value)) {
    return {
      text: '', lines: [], truncated: false, empty: true, width: 0, max: spec.maxPx || 0,
    };
  }
  if (spec.maxPx) return truncateToWidth(value, spec.font, spec.maxPx, spec.ellipsis ?? ' ...');
  return wrapLines(value, spec.font, spec.width, spec.lines, spec.ellipsis ?? '…');
}
