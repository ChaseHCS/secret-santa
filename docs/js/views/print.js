// Printable cards: QR cards (spoiler-free) or fold-over slips.
import { cx, h, mount } from '../lib/dom.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { loadEvent } from '../core/events.js';
import { button, linkButton, notice, radioCards } from '../ui/components.js';
import { qrSvg } from '../ui/qr.js';
import { entryUrl } from './event-share.js';

export default function printView({ root, parts, query }) {
  document.title = 'Print cards · Secret Santa';
  const ev = loadEvent(parts[1]);
  if (!ev || !ev.draw) {
    mount(root, h('div', { class: 'container narrow page-pad center' }, h('h1', 'Draw names first'), linkButton('Back', ev ? `#/e/${ev.id}/draw` : '#/', { variant: 'primary' })));
    return;
  }
  let kind = query.get('kind') === 'slips' ? 'slips' : 'qr';
  const byId = new Map(ev.participants.map((p) => [p.id, p]));
  const sheet = h('div', { class: 'print-sheet' });
  const meta = [ev.date && formatDate(ev.date, ev.time), ev.budget !== null && `Budget ${formatMoney(ev.budget, ev.currency)}`].filter(Boolean).join(' · ');

  const qrCard = (p) => {
    const entry = ev.draw.entries[p.id];
    const svg = qrSvg(entryUrl(entry), { label: `QR code for ${p.name}` });
    return h(
      'article',
      { class: 'print-card' },
      h('p', { class: 'pc-event' }, `🎁 ${ev.name || 'Secret Santa'}`),
      h('h2', { class: 'pc-name' }, `${p.emoji} ${p.name}`),
      svg ? h('div', { class: 'pc-qr' }, svg) : h('p', { class: 'pc-warn' }, 'Link too long for a QR code. Send it digitally.'),
      h('p', { class: 'pc-hint' }, entry.sealed ? 'Scan with your phone camera, then enter your secret phrase.' : 'Scan with your phone camera to see who you’re buying for.'),
      meta && h('p', { class: 'pc-meta' }, meta),
    );
  };

  const slip = (p) => {
    const entry = ev.draw.entries[p.id];
    const r = entry.sealed ? null : byId.get(entry.recipientId);
    return h(
      'article',
      { class: 'print-card slip' },
      h('div', { class: 'slip-outside' }, h('p', { class: 'pc-event' }, `🎁 ${ev.name || 'Secret Santa'}`), h('h2', { class: 'pc-name' }, `For ${p.name}`), h('p', { class: 'pc-hint' }, 'No peeking until it’s yours!')),
      h(
        'div',
        { class: 'slip-inside' },
        r
          ? [h('p', { class: 'pc-hint' }, 'You’re the Secret Santa for'), h('h2', { class: 'pc-name' }, `${r.emoji} ${r.name}`), r.wishlist && h('p', { class: 'pc-wish' }, r.wishlist.split('\n').slice(0, 4).join(' · ')), meta && h('p', { class: 'pc-meta' }, meta)]
          : [h('p', { class: 'pc-hint' }, 'Sealed match: scan to open'), h('div', { class: 'pc-qr small' }, qrSvg(entryUrl(entry)))],
      ),
      h('div', { class: 'slip-flap' }, h('p', { class: 'pc-hint' }, '▲ Fold this flap up over the middle to hide the match ▲')),
    );
  };

  const render = () => {
    mount(sheet, ev.participants.map((p) => (kind === 'qr' ? qrCard(p) : slip(p))));
    sheet.className = cx(['print-sheet', `print-${kind}`]);
  };

  mount(
    root,
    h(
      'div',
      { class: 'container print-page' },
      h(
        'div',
        { class: 'no-print stack' },
        h('a', { href: `#/e/${ev.id}/draw`, class: 'back-link' }, '← Back to the exchange'),
        h('h1', 'Print cards'),
        radioCards(
          'print-kind',
          [
            { value: 'qr', emoji: '📱', label: 'QR cards', description: 'Spoiler-free. Each person scans their own card.' },
            { value: 'slips', emoji: '✂️', label: 'Fold-over slips', description: 'Name outside, match inside. Shows matches!' },
          ],
          kind,
          (v) => {
            kind = v;
            history.replaceState(null, '', `#/print/${ev.id}${v === 'slips' ? '?kind=slips' : ''}`);
            render();
          },
          { label: 'Card type' },
        ),
        notice('Tip: QR cards keep the surprise for you too. Slips print matches in plain text (blurred here on screen): cut them out, then fold the bottom flap up over the middle without looking.', 'info'),
        h('div', { class: 'btn-row' }, button('Print', { variant: 'primary', iconName: 'printer', onClick: () => window.print() })),
      ),
      sheet,
    ),
  );
  render();
}
