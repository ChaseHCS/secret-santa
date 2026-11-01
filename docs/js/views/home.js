import { h, mount } from '../lib/dom.js';
import { daysUntil, daysUntilChristmas, formatShortDate, plural, relativeDays } from '../lib/format.js';
import { getJSON } from '../lib/storage.js';
import { downloadFile, safeFilename } from '../lib/clipboard.js';
import {
  deleteEvent,
  demoEvent,
  drawStatus,
  duplicateForNextYear,
  exportAll,
  exportEvent,
  listEvents,
  loadEvent,
  parseBackup,
  saveEvent,
} from '../core/events.js';
import { navigate } from '../router.js';
import { icon } from '../ui/icons.js';
import { badge, button, linkButton } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { giftBox, ornaments } from '../ui/gift.js';
import { playPop } from '../fx/sound.js';

const FEATURES = [
  ['🎲', 'Fair, verifiable draws', 'Crypto-grade randomness, uniform over every valid draw. Nobody draws themselves.'],
  ['🔗', 'A private link for everyone', 'Each person gets their own link. Matches live inside the link, so nothing is uploaded anywhere.'],
  ['🔐', 'Sealed mode', 'End-to-end encrypted matches that even the organizer can’t peek at.'],
  ['🏠', 'Households & exclusions', 'Keep couples and families apart, or block any pair. Clashing rules get a plain-English explanation.'],
  ['🔁', 'Loops & no swaps', 'Optionally make one big gift chain, or rule out two-way swaps.'],
  ['📝', 'Sign-ups & wishlists', 'Send a sign-up link; people add their own wishlist and sizes.'],
  ['🎉', 'Delightful reveals', 'Unwrap a gift, scratch a card or open an envelope, with confetti and jingles.'],
  ['📱', 'Party mode', 'Drawing in person? Pass one phone around the room.'],
  ['🖨️', 'Printable cards', 'QR cards or fold-over slips for office parties and classrooms.'],
  ['✅', 'Draw fingerprint', 'Everyone can check their link came from the same draw.'],
  ['💡', 'Gift idea generator', '140+ ideas you can filter by budget and interest.'],
  ['📴', 'Works offline', 'Install it like an app. No accounts, ads or tracking.'],
];

function statusBadge(ev) {
  const st = drawStatus(ev);
  if (st.state === 'none') return badge('Draft', 'neutral', 'pencil');
  if (st.state === 'invalid') return badge('Needs a new draw', 'warn', 'triangle-alert');
  if (st.state === 'outdated') return badge('Links outdated', 'warn', 'refresh-cw');
  return badge('Names drawn', 'success', 'circle-check');
}

function eventCard(ev, refresh) {
  const n = ev.participants.length;
  const days = daysUntil(ev.date);
  const sent = ev.draw ? Object.values(ev.draw.entries).filter((e) => e.sentAt).length : 0;
  const more = h(
    'details',
    { class: 'menu' },
    h('summary', { class: 'icon-btn', 'aria-label': `More actions for ${ev.name || 'this exchange'}` }, icon('ellipsis')),
    h(
      'div',
      { class: 'menu-list' },
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item',
          onClick: () => {
            const next = duplicateForNextYear(loadEvent(ev.id) || ev);
            saveEvent(next);
            toast(`Created “${next.name}” with last time’s pairs blocked`, { type: 'success' });
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
          class: 'menu-item',
          onClick: () => {
            downloadFile(`${safeFilename(ev.name, 'exchange')}.secret-santa.json`, exportEvent(loadEvent(ev.id) || ev), 'application/json');
          },
        },
        icon('download', { size: 16 }),
        'Export backup',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item danger',
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Delete “${ev.name || 'Untitled exchange'}”?`,
              message: 'This removes it from this browser. Links you already sent keep working, but you won’t be able to resend them.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            const backup = loadEvent(ev.id);
            deleteEvent(ev.id);
            refresh();
            toast('Exchange deleted', {
              action: {
                label: 'Undo',
                onClick: () => {
                  if (backup) saveEvent(backup);
                  refresh();
                },
              },
            });
          },
        },
        icon('trash', { size: 16 }),
        'Delete',
      ),
    ),
  );
  return h(
    'article',
    { class: 'event-card' },
    h(
      'div',
      { class: 'event-card-top' },
      h('a', { href: `#/e/${ev.id}`, class: 'event-card-link' }, h('h3', { class: 'event-card-title' }, ev.name || 'Untitled exchange')),
      more,
    ),
    h(
      'p',
      { class: 'event-card-meta' },
      ev.date && h('span', icon('calendar', { size: 15 }), `${formatShortDate(ev.date, ev.time)} · ${relativeDays(days)}`),
      h('span', icon('users', { size: 15 }), plural(n, 'person', 'people')),
      ev.sealedMode && h('span', icon('lock', { size: 15 }), 'Sealed'),
    ),
    h('div', { class: 'event-card-foot' }, statusBadge(ev), ev.draw && h('span', { class: 'muted small' }, `${sent}/${n} links sent`)),
  );
}

export default function home({ root }) {
  document.title = 'Secret Santa: free, private gift exchange';
  const days = daysUntilChristmas();
  const list = h('div');

  const refresh = () => {
    const events = listEvents();
    const joined = (getJSON('joined', []) || []).filter((j) => j && j.name && j.eventName).slice(-5).reverse();
    mount(
      list,
      events.length
        ? h(
            'section',
            { class: 'section container', 'aria-labelledby': 'your-ex' },
            h(
              'div',
              { class: 'section-head' },
              h('h2', { id: 'your-ex' }, 'Your exchanges'),
              h('div', { class: 'row gap-sm' }, importButton(refresh), events.length > 1 && button('Export all', { iconName: 'download', size: 'sm', variant: 'ghost', onClick: () => downloadFile('secret-santa-backup.json', exportAll(listEvents()), 'application/json') })),
            ),
            h('div', { class: 'event-grid' }, events.map((ev) => eventCard(ev, refresh)), h('a', { href: '#/new', class: 'event-card event-card-new' }, icon('plus', { size: 28 }), h('span', 'New exchange'))),
          )
        : h('div', { class: 'container center import-row' }, h('span', { class: 'muted small' }, 'Moving to a new device?'), importButton(refresh)),
      joined.length
        ? h(
            'section',
            { class: 'section container' },
            h('h2', { class: 'h3' }, 'Exchanges you’ve joined'),
            h('ul', { class: 'joined-list' }, joined.map((j) => h('li', h('strong', j.eventName), ` as ${j.name}`, h('span', { class: 'muted small' }, ' · waiting for your link from the organizer')))),
          )
        : null,
    );
  };
  refresh();

  const box = giftBox({ className: 'hero-gift', tag: 'button', type: 'button', 'aria-label': 'Wiggle the present' });
  box.addEventListener('click', () => {
    box.classList.remove('wiggle');
    void box.offsetWidth;
    box.classList.add('wiggle');
    playPop();
  });

  root.append(
    h(
      'section',
      { class: 'hero' },
      h(
        'div',
        { class: 'container hero-inner' },
        h(
          'div',
          { class: 'hero-copy' },
          h('p', { class: 'eyebrow' }, days === 0 ? '🎄 It’s Christmas Day!' : `🎄 ${plural(days, 'day', 'days')} until Christmas`),
          h('h1', { class: 'hero-title' }, 'Secret Santa, ', h('span', { class: 'accent' }, 'sorted.')),
          h(
            'p',
            { class: 'lead' },
            'Draw names in seconds, send everyone a private link, and keep the surprise. No sign-ups, no servers, no snooping, and with sealed mode not even the organizer can peek.',
          ),
          h(
            'div',
            { class: 'hero-actions' },
            linkButton('Start an exchange', '#/new', { variant: 'primary', size: 'lg', iconName: 'sparkles' }),
            button('Try the demo', {
              variant: 'secondary',
              size: 'lg',
              iconName: 'play',
              onClick: () => {
                const ev = demoEvent();
                saveEvent(ev);
                navigate(`/e/${ev.id}/people`);
              },
            }),
          ),
          h('p', { class: 'hero-note muted small' }, icon('shield-check', { size: 16 }), 'Free, with no ads or accounts. Nothing you type leaves your device unless you send it.'),
        ),
        h('div', { class: 'hero-art' }, ornaments(), box),
      ),
    ),
    list,
    h(
      'section',
      { class: 'section container', 'aria-labelledby': 'how' },
      h('h2', { id: 'how', class: 'center' }, 'How it works'),
      h(
        'ol',
        { class: 'steps-row' },
        [
          ['1', '✍️', 'Set it up', 'Name your exchange, pick a date and budget.'],
          ['2', '👥', 'Add people', 'Type names or send a sign-up link. Add households and rules.'],
          ['3', '🎲', 'Draw & send', 'Everyone gets a private link by email, text, QR code or party mode.'],
        ].map(([num, emoji, title, text]) => h('li', { class: 'step-card' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, num), h('span', { class: 'step-emoji', 'aria-hidden': 'true' }, emoji), h('h3', title), h('p', { class: 'muted' }, text))),
      ),
    ),
    h(
      'section',
      { class: 'section container', 'aria-labelledby': 'features' },
      h('h2', { id: 'features', class: 'center' }, 'Everything you need, nothing you don’t'),
      h('ul', { class: 'feature-grid' }, FEATURES.map(([emoji, title, text]) => h('li', { class: 'feature' }, h('span', { class: 'feature-emoji', 'aria-hidden': 'true' }, emoji), h('h3', title), h('p', { class: 'muted' }, text)))),
      h('p', { class: 'center' }, linkButton('Read how the privacy works', '#/about', { variant: 'ghost', iconName: 'shield-check' })),
    ),
  );
}

function importButton(refresh) {
  const inputEl = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
    onChange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast('That file is too large to be a backup.', { type: 'error' });
        return;
      }
      try {
        const events = parseBackup(await file.text());
        let count = 0;
        for (const ev of events) {
          const existing = loadEvent(ev.id);
          if (existing && existing.updatedAt > ev.updatedAt) {
            const ok = await confirmDialog({
              title: `Replace “${existing.name || 'Untitled exchange'}”?`,
              message: 'The copy in this browser is newer than the one in the backup.',
              confirmLabel: 'Replace with backup',
              danger: true,
            });
            if (!ok) continue;
          }
          saveEvent(ev);
          count++;
        }
        refresh();
        toast(`Imported ${plural(count, 'exchange', 'exchanges')}`, { type: 'success' });
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    },
  });
  return h('span', inputEl, button('Import backup', { iconName: 'upload', size: 'sm', variant: 'ghost', onClick: () => inputEl.click() }));
}

export { importButton };
