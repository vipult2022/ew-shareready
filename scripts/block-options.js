import { toCamelCase, toClassName } from './aem.js';

const NOT_A_KEY = 'img, picture, a, h1, h2, h3, h4, h5, h6, ul, ol, table, .icon';

/**
 * Reads a block's settings rows, such as `theme | dark` or `background | <picture>`,
 * and removes them so they never render as content (an extra card or slide).
 * These are the rows Block Studio and the EW Block Inspector write for the block's
 * `options` sheet entries. Only two-cell rows whose first cell is plain text naming
 * one of `keys` are read; anything else is left alone.
 * A text value is also set as `data-{key}` (as a class-style token, so CSS can use
 * `.cards[data-theme='dark']`). An image value is returned as its picture.
 * @param {Element} block The block element, before it is restructured
 * @param {string[]} keys The option keys the block understands
 * @returns {Object<string, string|Element>} values by key
 */
export default function readBlockOptions(block, keys) {
  const wanted = new Set(keys.map((key) => toClassName(key)));
  const values = {};
  [...block.children].forEach((row) => {
    const cells = [...row.children];
    if (cells.length !== 2) return;
    const [keyCell, valueCell] = cells;
    if (keyCell.querySelector(NOT_A_KEY)) return;
    const key = toClassName(keyCell.textContent);
    if (!wanted.has(key)) return;
    const picture = valueCell.querySelector('picture');
    if (picture) {
      values[key] = picture;
    } else {
      const value = valueCell.textContent.trim();
      values[key] = value;
      if (value) block.dataset[toCamelCase(key)] = toClassName(value);
    }
    row.remove();
  });
  return values;
}
