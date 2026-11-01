// Exchange dashboard: header, stepper and autosave. Steps live in event-*.js.
import { cx, debounce, h, mount } from '../lib/dom.js';
import { daysUntil, formatMoney, formatShortDate, plural, relativeDays } from '../lib/format.js';
import { downloadFile, safeFilename } from '../lib/clipboard.js';
import {
  deleteEvent,
  drawStatus,
  duplicateForNextYear,
  eventStorageKey,
  exportEvent,
  loadEvent,
  saveEvent,
} from '../core/events.js';
import { clearPendingEvent, navigate, takePendingEvent } from '../router.js';
import { icon } from '../ui/icons.js';
import { badge, linkButton } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import detailsStep from './event-details.js';
import peopleStep from './event-people.js';
import rulesStep from './event-rules.js';
import shareStep from './event-share.js';

const STEPS = [
  { id: 'details', label: 'Details', iconName: 'pencil', render: detailsStep },
  { id: 'people', label: 'People', iconName: 'users', render: peopleStep },
  { id: 'rules', label: 'Rules', iconName: 'ban', render: rulesStep },
  { id: 'draw', label: 'Draw & send', iconName: 'shuffle', render: shareStep },
];

function defaultStep(ev) {
  if (ev.draw) return 'draw';
  if (ev.participants.length) return 'people';
  return 'details';
}

export function statusBadgeFor(ev) {
  const st = drawStatus(ev);
  if (st.state === 'none') return badge('Draft', 'neutral', 'pencil');
  if (st.state === 'invalid') return badge('Needs a new draw', 'warn', 'triangle-alert');
  if (st.state === 'outdated') return badge('Links outdated', 'warn', 'refresh-cw');
  return badge('Names drawn', 'success', 'circle-check');
}

export default function eventView({ root, parts }) {
  const id = parts[1];
  let ev = loadEvent(id);
  let pending = false;
  if (!ev) {
    ev = takePendingEvent(id);
    pending = !!ev;
  }
  if (!ev) {
    document.title = 'Exchange not found · Secret Santa';
    root.append(
      h(
        'div',
        { class: 'container narrow page-pad center' },
        h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, '🔍'),
        h('h1', 'We couldn’t find that exchange'),
        h('p', { class: 'muted' }, 'Exchanges are saved in the browser where they were created. If you made it on another device, export a backup there and import it here.'),
        linkButton('Back to your exchanges', '#/', { variant: 'primary' }),
      ),
    );
    return undefined;
  }

  const step = STEPS.find((s) => s.id === parts[2]) || STEPS.find((s) => s.id === defaultStep(ev));
  let dirty = false;
  const cleanups = [];
  const savedEl = h('span', { class: 'save-state', 'aria-live': 'polite' });

  const saveNow = () => {
    if (!dirty) return;
    dirty = false;
    if (pending) {
      clearPendingEvent(ev.id);
      pending = false;
    }
    const ok = saveEvent(ev);
    savedEl.className = cx(['save-state', ok ? 'ok' : 'err']);
    savedEl.replaceChildren(icon(ok ? 'check' : 'triangle-alert', { size: 14 }), ok ? 'Saved' : 'Couldn’t save (storage full or blocked). Export a backup!');
    if (!ok) toast('Couldn’t save your changes. Your browser storage may be full.', { type: 'error' });
  };
  const save = debounce(saveNow, 250);

  const header = h('div', { class: 'event-header' });
  const stepper = h('nav', { class: 'stepper', 'aria-label': 'Steps' });
  const panel = h('div', { class: 'step-panel', id: 'step-panel' });
  const stepNav = h('div', { class: 'step-nav' });

  const ctx = {
    get ev() {
      return ev;
    },
    /** Apply a change, autosave, refresh header/stepper (and optionally the step). */
    change(mutator, { rerender = false } = {}) {
      mutator(ev);
      dirty = true;
      save();
      renderChrome();
      if (rerender) renderStep();
    },
    flush() {
      save.flush();
    },
    rerender: () => renderStep(),
    renderChrome: () => renderChrome(),
    onCleanup(fn) {
      cleanups.push(fn);
    },
    go(stepId) {
      save.flush();
      navigate(`/e/${ev.id}/${stepId}`);
    },
  };

  function renderHeader() {
    const days = daysUntil(ev.date);
    const menu = h(
      'details',
      { class: 'menu menu-right' },
      h('summary', { class: 'btn btn-ghost btn-sm', 'aria-label': 'More actions' }, icon('ellipsis', { size: 18 }), h('span', { class: 'hide-sm' }, 'More')),
      h(
        'div',
        { class: 'menu-list' },
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            onClick: () => {
              save.flush();
              downloadFile(`${safeFilename(ev.name, 'exchange')}.secret-santa.json`, exportEvent(ev), 'application/json');
            },
          },
          icon('download', { size: 16 }),
          'Export backup',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            onClick: () => {
              save.flush();
              const next = duplicateForNextYear(ev);
              saveEvent(next);
              toast(`Created “${next.name}”${next.rules.avoid.length ? ' with this year’s pairs blocked' : ''}`, { type: 'success' });
              navigate(`/e/${next.id}/details`);
            },
          },
          icon('files', { size: 16 }),
          'Copy for next year',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item danger',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this exchange?',
                message: 'It will be removed from this browser. Links you already sent keep working.',
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              save.cancel();
              dirty = false;
              deleteEvent(ev.id);
              clearPendingEvent(ev.id);
              toast('Exchange deleted');
              navigate('/');
            },
          },
          icon('trash', { size: 16 }),
          'Delete exchange',
        ),
      ),
    );
    mount(
      header,
      h('a', { href: '#/', class: 'back-link' }, icon('arrow-left', { size: 16 }), 'All exchanges'),
      h(
        'div',
        { class: 'event-title-row' },
        h('h1', { class: 'event-title' }, ev.name || 'Untitled exchange'),
        statusBadgeFor(ev),
      ),
      h(
        'div',
        { class: 'event-meta-row' },
        h(
          'p',
          { class: 'event-meta' },
          ev.date && h('span', icon('calendar', { size: 15 }), `${formatShortDate(ev.date, ev.time)} (${relativeDays(days)})`),
          h('span', icon('users', { size: 15 }), plural(ev.participants.length, 'person', 'people')),
          ev.budget !== null && h('span', icon('wallet', { size: 15 }), formatMoney(ev.budget, ev.currency)),
          ev.sealedMode && h('span', icon('lock', { size: 15 }), 'Sealed mode'),
          savedEl,
        ),
        h('div', { class: 'event-actions' }, linkButton('Preview', `#/preview/${ev.id}`, { variant: 'ghost', size: 'sm', iconName: 'eye', onClick: () => save.flush() }), menu),
      ),
    );
  }

  function renderStepper() {
    const st = drawStatus(ev);
    const done = {
      details: !!ev.name,
      people: ev.participants.length >= 3,
      rules: false,
      draw: st.state === 'ok',
    };
    mount(
      stepper,
      h(
        'ol',
        { class: 'stepper-list' },
        STEPS.map((s, i) =>
          h(
            'li',
            null,
            h(
              'a',
              {
                href: `#/e/${ev.id}/${s.id}`,
                class: cx(['stepper-item', s.id === step.id && 'active', done[s.id] && 'done']),
                'aria-current': s.id === step.id ? 'step' : undefined,
                onClick: () => save.flush(),
              },
              h('span', { class: 'stepper-num', 'aria-hidden': 'true' }, done[s.id] && s.id !== step.id ? icon('check', { size: 14 }) : String(i + 1)),
              h('span', { class: 'stepper-label' }, s.label, s.id === 'people' && ev.participants.length ? h('span', { class: 'stepper-count' }, ` ${ev.participants.length}`) : null),
            ),
          ),
        ),
      ),
    );
  }

  function renderChrome() {
    renderHeader();
    renderStepper();
  }

  function renderStepNav() {
    const i = STEPS.indexOf(step);
    const prev = STEPS[i - 1];
    const next = STEPS[i + 1];
    mount(
      stepNav,
      prev ? h('a', { href: `#/e/${ev.id}/${prev.id}`, class: 'btn btn-ghost', onClick: () => save.flush() }, icon('arrow-left', { size: 18 }), `Back: ${prev.label}`) : h('span'),
      next ? h('a', { href: `#/e/${ev.id}/${next.id}`, class: 'btn btn-primary', onClick: () => save.flush() }, `Next: ${next.label}`, icon('arrow-right', { size: 18 })) : null,
    );
  }

  function renderStep() {
    while (cleanups.length) {
      try {
        cleanups.pop()();
      } catch (e) {
        console.error(e);
      }
    }
    mount(panel, step.render(ctx));
    renderStepNav();
  }

  document.title = `${ev.name || 'Untitled exchange'} · ${step.label} · Secret Santa`;
  root.append(h('div', { class: 'container event-page' }, header, stepper, panel, stepNav));
  renderChrome();
  renderStep();

  const onStorage = (e) => {
    if (e.key !== eventStorageKey(ev.id) || dirty) return;
    if (!e.newValue) {
      toast('This exchange was deleted in another tab.', { type: 'warn' });
      navigate('/');
      return;
    }
    const fresh = loadEvent(ev.id);
    if (!fresh) return;
    ev = fresh;
    renderChrome();
    renderStep();
    toast('Updated from another tab');
  };
  window.addEventListener('storage', onStorage);
  const onBeforeUnload = () => save.flush();
  window.addEventListener('beforeunload', onBeforeUnload);
  const onPageHide = () => save.flush();
  window.addEventListener('pagehide', onPageHide);

  return () => {
    save.flush();
    while (cleanups.length) cleanups.pop()();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
  };
}
