import { h } from './dom.js';

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function verdict(result) {
  if (result.counts.error) return { label: 'Not ready to share', tone: 'error' };
  if (result.counts.warning) return { label: 'Almost ready', tone: 'warning' };
  return { label: 'Ready to share', tone: 'pass' };
}

export function worst(issues) {
  if (issues.some((c) => c.severity === 'error')) return 'error';
  if (issues.some((c) => c.severity === 'warning')) return 'warning';
  return 'pass';
}

export function ring(score, tone) {
  return h(
    'div',
    {
      class: `sr-ring sr-tone-${tone}`, style: { '--p': String(score) }, role: 'img', 'aria-label': `Share score ${score} of 100`,
    },
    h('span', {}, String(score)),
  );
}

/** Fits each preview frame in its stage by zooming it out (frames render at native width). */
export function fitFrames(root) {
  root.querySelectorAll('.sr-stage').forEach((stage) => {
    const frame = stage.firstElementChild;
    if (!frame) return;
    const style = getComputedStyle(stage);
    const available = stage.clientWidth
      - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const native = parseFloat(frame.style.width) || frame.offsetWidth;
    frame.style.zoom = String(Math.min(1, available / native));
  });
}
