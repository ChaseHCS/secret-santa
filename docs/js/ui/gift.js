// CSS-drawn gift box, envelope and decorative pieces.
import { cx, h } from '../lib/dom.js';

export function giftBox({ className = '', tag = 'div', ...props } = {}) {
  return h(
    tag,
    { class: cx(['giftbox', className]), ...props },
    h(
      'span',
      { class: 'gb-lid', 'aria-hidden': 'true' },
      h('span', { class: 'gb-bow' }, h('span', { class: 'gb-loop gb-loop-l' }), h('span', { class: 'gb-loop gb-loop-r' }), h('span', { class: 'gb-knot' })),
      h('span', { class: 'gb-lid-ribbon' }),
    ),
    h('span', { class: 'gb-body', 'aria-hidden': 'true' }, h('span', { class: 'gb-body-ribbon' })),
  );
}

export function envelope({ className = '', tag = 'div', letter = null, ...props } = {}) {
  return h(
    tag,
    { class: cx(['envelope', className]), ...props },
    h('span', { class: 'env-back', 'aria-hidden': 'true' }),
    h('span', { class: 'env-letter', 'aria-hidden': 'true' }, letter),
    h('span', { class: 'env-front', 'aria-hidden': 'true' }),
    h('span', { class: 'env-flap', 'aria-hidden': 'true' }),
    h('span', { class: 'env-seal', 'aria-hidden': 'true' }, '🎅'),
  );
}

export function ornaments() {
  return h(
    'div',
    { class: 'ornaments', 'aria-hidden': 'true' },
    h('span', { class: 'orn orn-1' }),
    h('span', { class: 'orn orn-2' }),
    h('span', { class: 'orn orn-3' }),
    h('span', { class: 'sparkle sp-1' }, '✦'),
    h('span', { class: 'sparkle sp-2' }, '✧'),
    h('span', { class: 'sparkle sp-3' }, '✦'),
  );
}
