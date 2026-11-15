/**
 * Tiny DOM helpers. Content from the author's draft is always inserted as text,
 * never as HTML, so a draft can't inject markup into ReviewLoop.
 */

function append(el, child) {
  if (child === undefined || child === null || child === false) return;
  if (Array.isArray(child)) {
    child.forEach((c) => append(el, c));
    return;
  }
  el.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      Object.entries(value).forEach(([prop, val]) => el.style.setProperty(prop, val));
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value === true ? '' : value);
  });
  append(el, children);
  return el;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}
