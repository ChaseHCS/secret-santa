// #/add/<code>: a participant's sign-up reply, opened on the organizer's device.
import { h, mount } from '../lib/dom.js';
import { applyJoin, loadEvent, previewJoin, saveEvent } from '../core/events.js';
import { decodeJoin } from '../core/payload.js';
import { navigate } from '../router.js';
import { avatar, badge, button, linkButton, notice } from '../ui/components.js';
import { wishlistList } from '../lib/linkify.js';
import { toast } from '../ui/toast.js';
import { linkErrorView } from './reveal.js';

export default async function addView({ root, parts }) {
  document.title = 'Add a sign-up · Secret Santa';
  let j;
  try {
    j = await decodeJoin(parts[1] || '');
  } catch (e) {
    mount(root, linkErrorView(e));
    return;
  }
  const ev = loadEvent(j.e);
  if (!ev) {
    mount(
      root,
      h(
        'div',
        { class: 'container narrow page-pad center' },
        h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, '📬'),
        h('h1', `${j.n} signed up!`),
        h('p', { class: 'lead' }, 'But the exchange isn’t on this device. Open this link on the device where the exchange was created (the organizer’s), or paste it into “Import sign-ups” there.'),
        linkButton('Go to the home page', '#/', { variant: 'secondary' }),
      ),
    );
    return;
  }
  const pv = previewJoin(ev, j);
  const add = () => {
    const fresh = loadEvent(j.e);
    const res = applyJoin(fresh, j);
    if (res === 'full') {
      toast('This exchange is full.', { type: 'error' });
      return;
    }
    saveEvent(fresh);
    toast(res === 'added' ? `Added ${j.n}` : res === 'same' ? `${j.n} was already added` : `Updated ${j.n}`, { type: 'success' });
    navigate(`/e/${j.e}/people`);
  };
  mount(
    root,
    h(
      'div',
      { class: 'container narrow page-pad stack-lg' },
      h(
        'div',
        { class: 'center stack-sm' },
        avatar(j.a || '🎁', { size: 'xl' }),
        h('h1', pv.status === 'new' ? `Add ${j.n} to “${ev.name || 'your exchange'}”?` : pv.status === 'same' ? `${j.n} is already in` : `Update ${j.n}?`),
        h('div', { class: 'row gap-sm center-row' }, j.k && badge('Sealed key', 'info', 'lock'), j.em && badge(j.em, 'neutral', 'mail')),
      ),
      pv.keyChange && notice(`This replaces ${j.n}’s existing secret-phrase key. Only continue if ${j.n} really sent you this link; otherwise someone else could read their match.`, 'warn'),
      ev.draw && pv.status !== 'same' && notice('Names have already been drawn, so you’ll need to draw again (or update the links) afterwards.', 'warn'),
      j.w && h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Wishlist'), wishlistList(j.w)),
      h(
        'div',
        { class: 'btn-row center-row' },
        linkButton('Cancel', `#/e/${ev.id}/people`, { variant: 'ghost' }),
        pv.status !== 'same' && pv.status !== 'full' && button(pv.status === 'new' ? `Add ${j.n}` : `Update ${j.n}`, { variant: 'primary', iconName: 'user-plus', onClick: add }),
      ),
    ),
  );
}
