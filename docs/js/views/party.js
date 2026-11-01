// Party mode: one device passed around the room.
import { cx, h, mount } from '../lib/dom.js';
import { loadEvent, saveEvent, drawStatus } from '../core/events.js';
import { decodeReveal, decodeSealed } from '../core/payload.js';
import { avatar, button, linkButton, notice } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { revealExperience } from '../ui/reveal.js';
import { sealedUnlock, linkErrorView } from './reveal.js';

export default function partyView({ root, parts }) {
  document.title = 'Party mode · Secret Santa';
  let ev = loadEvent(parts[1]);
  if (!ev || !ev.draw) {
    mount(
      root,
      h(
        'div',
        { class: 'container narrow page-pad center' },
        h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, '🎉'),
        h('h1', 'Draw names first'),
        h('p', { class: 'muted' }, 'Party mode needs an exchange with names already drawn.'),
        linkButton('Back', ev ? `#/e/${ev.id}/draw` : '#/', { variant: 'primary' }),
      ),
    );
    return undefined;
  }
  document.body.dataset.eventTheme = ev.theme;
  let wakeLock = null;
  let current = null;

  const requestWake = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  };
  requestWake();
  const onVis = () => {
    if (document.visibilityState === 'visible' && !wakeLock) requestWake();
  };
  document.addEventListener('visibilitychange', onVis);

  const markViewed = (id) => {
    ev = loadEvent(ev.id) || ev;
    ev.party.viewed[id] = Date.now();
    saveEvent(ev);
  };

  function grid() {
    if (current) current.destroy();
    current = null;
    const viewed = ev.party.viewed || {};
    const left = ev.participants.filter((p) => !viewed[p.id]).length;
    const st = drawStatus(ev);
    mount(
      root,
      h(
        'div',
        { class: 'container party' },
        h(
          'div',
          { class: 'party-head' },
          h('p', { class: 'eyebrow' }, 'Party mode'),
          h('h1', ev.name || 'Secret Santa'),
          h('p', { class: 'lead' }, left ? `Pass the phone around. Tap your name to see who you’re buying for. ${left} still to go.` : 'Everyone has seen their match! 🎉'),
        ),
        st.state !== 'ok' && notice('The draw is out of date with your latest edits. Matches shown here are from the last draw.', 'warn'),
        h(
          'ul',
          { class: 'party-grid' },
          ev.participants.map((p) =>
            h(
              'li',
              null,
              h(
                'button',
                {
                  type: 'button',
                  class: cx(['party-person', viewed[p.id] && 'viewed']),
                  onClick: () => turn(p),
                  'aria-label': viewed[p.id] ? `${p.name} (already looked)` : p.name,
                },
                avatar(p.emoji, { size: 'lg' }),
                h('span', { class: 'party-name' }, p.name),
                viewed[p.id] && h('span', { class: 'party-check' }, icon('check', { size: 16 }), 'Looked'),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'btn-row center-row' },
          linkButton('Exit party mode', `#/e/${ev.id}/draw`, { variant: 'ghost', iconName: 'arrow-left' }),
          Object.keys(viewed).length > 0 &&
            button('Reset who’s looked', {
              variant: 'ghost',
              iconName: 'rotate-ccw',
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Reset everyone?', message: 'Everyone will be able to look again.', confirmLabel: 'Reset' }))) return;
                ev = loadEvent(ev.id) || ev;
                ev.party.viewed = {};
                saveEvent(ev);
                grid();
              },
            }),
        ),
      ),
    );
  }

  async function turn(p) {
    const viewed = (ev.party.viewed || {})[p.id];
    if (viewed) {
      const ok = await confirmDialog({
        title: `${p.name} already looked`,
        message: `Only continue if you’re ${p.name} and need a reminder.`,
        confirmLabel: `I’m ${p.name}, show me`,
      });
      if (!ok) return;
    }
    const entry = ev.draw.entries[p.id];
    const back = button('Not me, go back', { variant: 'ghost', iconName: 'arrow-left', onClick: grid });
    mount(
      root,
      h(
        'div',
        { class: 'container narrow party-turn center' },
        avatar(p.emoji, { size: 'xl' }),
        h('h1', `Pass the phone to ${p.name}`),
        h('p', { class: 'lead' }, 'Make sure nobody else is peeking! 👀'),
        h('div', { class: 'btn-row center-row' }, back, button(`I’m ${p.name}`, { variant: 'primary', size: 'lg', iconName: 'eye', onClick: () => show(p, entry) })),
      ),
    );
    root.querySelector('h1').focus();
  }

  async function show(p, entry) {
    const done = () => {
      markViewed(p.id);
      grid();
    };
    const present = (reveal) => {
      current = revealExperience(reveal, { party: true, onDone: done, doneLabel: 'Done: hide it & pass the phone' });
      mount(root, h('div', { class: 'container narrow reveal-page' }, current.el));
    };
    try {
      if (entry.sealed) {
        const sealed = decodeSealed(entry.link);
        const form = sealedUnlock(sealed, { party: true, onUnlocked: (reveal) => present(reveal) });
        mount(root, h('div', { class: 'container narrow reveal-page' }, form.el, h('p', { class: 'center' }, button('Back', { variant: 'ghost', iconName: 'arrow-left', onClick: grid }))));
        const inp = root.querySelector('#unlock-pass');
        if (inp) inp.focus();
      } else {
        present(await decodeReveal(entry.link));
      }
    } catch (e) {
      mount(root, linkErrorView(e));
    }
  }

  grid();
  return () => {
    if (current) current.destroy();
    document.removeEventListener('visibilitychange', onVis);
    if (wakeLock) wakeLock.release().catch(() => {});
  };
}
