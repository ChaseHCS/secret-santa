import { ICONS } from '../vendor/lucide-icons.js';
import { cx, s } from '../lib/dom.js';

export function icon(name, { size = 20, label = '', className = '' } = {}) {
  const nodes = ICONS[name];
  if (!nodes) throw new Error(`Unknown icon: ${name}`);
  return s(
    'svg',
    {
      class: cx(['icon', className]),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      focusable: 'false',
      'aria-hidden': label ? undefined : 'true',
      role: label ? 'img' : undefined,
      'aria-label': label || undefined,
    },
    nodes.map(([tag, attrs]) => s(tag, attrs)),
  );
}
