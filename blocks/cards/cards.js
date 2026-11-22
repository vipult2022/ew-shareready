import { createOptimizedPicture } from '../../scripts/aem.js';
import readBlockOptions from '../../scripts/block-options.js';

const optimize = (picture, width = '750') => {
  const img = picture.querySelector('img');
  return img ? createOptimizedPicture(img.src, img.alt, false, [{ width }]) : picture;
};

const isPictureOnly = (cell) => cell.children.length === 1 && !!cell.querySelector('picture')
  && !cell.textContent.trim();
const isEmpty = (cell) => !cell.textContent.trim() && !cell.querySelector('picture, img, .icon, a');

export default function decorate(block) {
  // Settings rows (theme, background) are options, not cards.
  const { background } = readBlockOptions(block, ['theme', 'background']);

  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    [...row.children].forEach((cell, column) => {
      if (isEmpty(cell)) return;
      li.append(cell);
      // The third column is the card's background image (the `fields` sheet's "Card background").
      if (column >= 2 && isPictureOnly(cell)) {
        cell.className = 'cards-card-bg';
        li.classList.add('has-bg');
      } else if (cell.children.length === 1 && cell.querySelector('picture')) {
        cell.className = 'cards-card-image';
      } else {
        cell.className = 'cards-card-body';
      }
    });
    if (li.children.length) ul.append(li);
  });
  ul.querySelectorAll('picture').forEach((picture) => {
    const wide = picture.closest('.cards-card-bg');
    picture.replaceWith(optimize(picture, wide ? '1200' : '750'));
  });

  const parts = [ul];
  // A background row typed as text (`background | none`) has no picture to show.
  if (background instanceof Element) {
    const bg = document.createElement('div');
    bg.className = 'cards-bg';
    bg.append(optimize(background, '2000'));
    parts.unshift(bg);
    block.classList.add('has-bg');
  }
  block.replaceChildren(...parts);
}
