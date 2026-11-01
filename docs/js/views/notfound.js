import { h } from '../lib/dom.js';
import { linkButton } from '../ui/components.js';

export default function notFound({ root }) {
  document.title = 'Page not found · Secret Santa';
  root.append(
    h(
      'div',
      { class: 'container narrow page-pad center' },
      h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, '🦌💨'),
      h('h1', 'This page flew off with the reindeer'),
      h('p', { class: 'muted' }, 'We couldn’t find what you were looking for. If you opened a Secret Santa link, make sure you copied all of it.'),
      linkButton('Go home', '#/', { variant: 'primary' }),
    ),
  );
}
