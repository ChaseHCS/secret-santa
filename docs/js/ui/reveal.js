// The reveal experience shared by link pages, sealed pages, party mode and previews.
import { add, cx, h, prefersReducedMotion, wait } from '../lib/dom.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { downloadFile, safeFilename } from '../lib/clipboard.js';
import { richText, wishlistList } from '../lib/linkify.js';
import { buildIcs, googleCalendarUrl } from '../lib/ics.js';
import { approxUsd } from '../data/currencies.js';
import { verifyReveal } from '../core/payload.js';
import { confetti } from '../fx/confetti.js';
import { playJingle, playPop } from '../fx/sound.js';
import { avatar, button } from './components.js';
import { countdown } from './countdown.js';
import { envelope, giftBox } from './gift.js';
import { icon } from './icons.js';
import { scratchCard } from './scratch.js';

const THEME_CONFETTI = {
  classic: ['#d7263d', '#1e8a5a', '#f2c14e', '#ffffff'],
  frost: ['#7cc6fe', '#d6ecff', '#ffffff', '#a0b6d8'],
  candy: ['#ff4d6d', '#ffffff', '#ff8fab', '#ffd6e0'],
  evergreen: ['#2e7d4f', '#a7d7a8', '#f2c14e', '#fff6e0'],
  midnight: ['#f2c14e', '#ffe08a', '#8aa4ff', '#ffffff'],
};

export function tierForBudget(amount, currency) {
  const usd = approxUsd(amount, currency);
  if (usd === null) return null;
  if (usd <= 15) return 1;
  if (usd <= 40) return 2;
  if (usd <= 100) return 3;
  return 4;
}

function verificationBadge(reveal) {
  const el = h('div', { class: 'verify verify-pending' }, icon('shield-check', { size: 16 }), h('span', 'Checking draw fingerprint…'));
  if (!reveal.v) {
    el.className = 'verify verify-none';
    el.replaceChildren(icon('info', { size: 16 }), h('span', 'This link has no draw fingerprint.'));
    return el;
  }
  verifyReveal(reveal)
    .then((v) => {
      if (v.status === 'verified') {
        el.className = 'verify verify-ok';
        el.replaceChildren(
          icon('badge-check', { size: 18 }),
          h(
            'div',
            h('span', { class: 'verify-title' }, 'Draw fingerprint '),
            h('span', { class: 'fp-inline', 'aria-label': `${v.fingerprint.emoji.join(' ')} ${v.fingerprint.code}` }, `${v.fingerprint.emoji.join(' ')}  ${v.fingerprint.code}`),
            h('span', { class: 'verify-sub' }, `Your match is cryptographically part of a draw of ${v.count} people. Compare this fingerprint with others in your group: if everyone sees the same one, all links came from the same draw.`),
          ),
        );
      } else {
        el.className = 'verify verify-bad';
        el.replaceChildren(icon('triangle-alert', { size: 18 }), h('span', 'This link failed its integrity check. It may have been edited. Ask the organizer to resend it.'));
      }
    })
    .catch(() => {
      el.className = 'verify verify-none';
      el.replaceChildren(icon('info', { size: 16 }), h('span', 'Couldn’t check the draw fingerprint in this browser.'));
    });
  return el;
}

function eventInfo(ev, cleanups) {
  const rows = [];
  if (ev.d) rows.push(h('div', { class: 'info-row' }, icon('calendar'), h('div', h('strong', formatDate(ev.d, ev.t)))));
  if (ev.b !== null) rows.push(h('div', { class: 'info-row' }, icon('wallet'), h('div', 'Budget: ', h('strong', formatMoney(ev.b, ev.c)))));
  if (ev.l) rows.push(h('div', { class: 'info-row' }, icon('map-pin'), h('div', ev.l)));
  if (ev.o) rows.push(h('div', { class: 'info-row' }, icon('user'), h('div', 'Organized by ', h('strong', ev.o))));
  const cd = ev.d ? countdown(ev.d, ev.t) : null;
  if (cd) cleanups.push(cd.stop);
  return h(
    'section',
    { class: 'reveal-card info-card' },
    h('h3', icon('gift'), ev.n),
    cd && cd.el,
    rows.length ? h('div', { class: 'info-rows' }, rows) : null,
    ev.m && h('blockquote', { class: 'organizer-msg' }, richText(ev.m)),
  );
}

function actions(reveal) {
  const ev = reveal.ev;
  const out = [];
  if (ev.d) {
    const title = `🎁 ${ev.n}`;
    const description = [
      'Secret Santa gift exchange.',
      ev.b !== null ? `Budget: ${formatMoney(ev.b, ev.c)}` : '',
      ev.l ? `Where: ${ev.l}` : '',
      'Don’t forget your gift!',
    ]
      .filter(Boolean)
      .join('\n');
    out.push(
      button('Add to calendar', {
        iconName: 'calendar-plus',
        onClick: () =>
          downloadFile(
            `${safeFilename(ev.n, 'secret-santa')}.ics`,
            buildIcs({ uid: `${ev.id || 'secret-santa'}-${ev.d}@secret-santa`, title, date: ev.d, time: ev.t, description, location: ev.l }),
            'text/calendar',
          ),
      }),
      h('a', { class: 'btn btn-secondary', href: googleCalendarUrl({ title, date: ev.d, time: ev.t, description, location: ev.l }), target: '_blank', rel: 'noopener noreferrer' }, icon('external-link', { size: 18 }), h('span', 'Google Calendar')),
    );
  }
  const tier = tierForBudget(ev.b, ev.c);
  out.push(h('a', { class: 'btn btn-secondary', href: `#/ideas${tier ? `?tier=${tier}` : ''}` }, icon('lightbulb', { size: 18 }), h('span', tier ? `Gift ideas for ${formatMoney(ev.b, ev.c)}` : 'Gift ideas')));
  return h('div', { class: 'btn-row center-row' }, out);
}

/**
 * Build the interactive reveal.
 * @param reveal sanitized reveal payload
 * @param opts {party?:boolean, onDone?:()=>void, doneLabel?:string, preview?:boolean}
 */
export function revealExperience(reveal, opts = {}) {
  const ev = reveal.ev;
  const style = ev.rs;
  const cleanups = [];
  const root = h('div', { class: cx(['reveal', `reveal-${style}`]) });
  const stage = h('div', { class: 'reveal-stage' });
  const results = h('div', { class: 'reveal-results', hidden: true });
  let revealed = false;
  let busy = false;

  const greet = h(
    'div',
    { class: 'reveal-greet' },
    h('p', { class: 'eyebrow' }, ev.n),
    h('h1', { class: 'reveal-hello' }, `Hi ${reveal.g}! `, h('span', { 'aria-hidden': 'true' }, reveal.ga || '👋')),
    h('p', { class: 'lead' }, 'You’re someone’s Secret Santa… time to find out whose.'),
  );

  function showResults() {
    if (revealed) return;
    revealed = true;
    stage.remove();
    greet.querySelector('.lead').remove();
    const nameId = `match-${Math.random().toString(36).slice(2)}`;
    const matchCard = h(
      'section',
      { class: 'reveal-card match-card', 'aria-labelledby': nameId },
      h('p', { class: 'match-eyebrow' }, 'You’re the Secret Santa for…'),
      avatar(reveal.ra || '🎁', { size: 'xl' }),
      h('h2', { class: 'match-name', id: nameId, tabindex: '-1' }, reveal.r),
      h('p', { class: 'match-sub' }, '🤫 Shh! Keep it a secret.'),
    );
    const hideable = h('div', { class: 'hideable' });
    hideable.append(
      matchCard,
      h(
        'section',
        { class: 'reveal-card wish-card' },
        h('h3', icon('list-checks'), `${reveal.r}’s wishlist`),
        reveal.w
          ? wishlistList(reveal.w)
          : h('p', { class: 'muted' }, `${reveal.r} didn’t add a wishlist. Check out the gift ideas below, or ask the organizer to find out a hint.`),
        reveal.no && h('div', { class: 'notes' }, h('h4', icon('notebook-pen', { size: 16 }), 'Notes for their Santa'), richText(reveal.no)),
      ),
    );
    const hideBtn = button('Hide', { variant: 'ghost', size: 'sm', iconName: 'eye-off' });
    hideBtn.addEventListener('click', () => {
      const hidden = hideable.classList.toggle('is-hidden');
      hideBtn.querySelector('span').textContent = hidden ? 'Show again' : 'Hide';
      hideBtn.replaceChild(icon(hidden ? 'eye' : 'eye-off', { size: 16 }), hideBtn.querySelector('svg'));
      hideBtn.setAttribute('aria-pressed', String(hidden));
    });
    hideBtn.setAttribute('aria-pressed', 'false');

    add(
      results,
      h('div', { class: 'hide-row' }, hideBtn),
      hideable,
      opts.onDone
        ? h(
            'div',
            { class: 'center party-done' },
            button(opts.doneLabel || 'Done', { variant: 'primary', size: 'xl', iconName: 'eye-off', onClick: opts.onDone }),
          )
        : null,
      !opts.party && eventInfo(ev, cleanups),
      !opts.party && actions(reveal),
      !opts.party && !opts.preview && verificationBadge(reveal),
    );
    results.hidden = false;
    const t = THEME_CONFETTI[ev.th] || THEME_CONFETTI.classic;
    confetti({ y: 0.32, colors: t });
    playJingle();
    const nameEl = results.querySelector('.match-name');
    if (nameEl) nameEl.focus({ preventScroll: true });
    matchCard.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (opts.onRevealed) opts.onRevealed();
  }

  async function animateThen(el, steps) {
    if (busy || revealed) return;
    busy = true;
    if (prefersReducedMotion()) {
      showResults();
      return;
    }
    for (const [cls, ms, fx] of steps) {
      el.classList.add(cls);
      if (fx) fx();
      await wait(ms);
    }
    showResults();
  }

  let interactive;
  let hint;
  if (style === 'scratch') {
    const prize = h('div', { class: 'prize-inner' }, h('span', { class: 'prize-emoji' }, reveal.ra || '🎁'), h('span', { class: 'prize-name' }, reveal.r));
    const sc = scratchCard(prize, { onComplete: () => setTimeout(showResults, 500) });
    cleanups.push(sc.destroy);
    interactive = sc.el;
    hint = 'Scratch the card to reveal your match';
  } else if (style === 'envelope') {
    interactive = envelope({
      tag: 'button',
      type: 'button',
      className: 'reveal-envelope',
      'aria-label': 'Open the envelope',
      letter: h('span', { class: 'env-q' }, '?'),
    });
    interactive.addEventListener('click', () =>
      animateThen(interactive, [
        ['is-wobble', 380, null],
        ['is-open', 1100, playPop],
      ]),
    );
    hint = 'Tap the envelope to break the seal';
  } else {
    interactive = giftBox({ tag: 'button', type: 'button', className: 'reveal-gift', 'aria-label': 'Unwrap your gift' });
    interactive.addEventListener('click', () =>
      animateThen(interactive, [
        ['is-shaking', 700, null],
        ['is-open', 750, playPop],
      ]),
    );
    hint = 'Tap the present to unwrap it';
  }

  stage.append(
    h('div', { class: 'reveal-interactive' }, interactive),
    h('p', { class: 'reveal-hint' }, icon('hand', { size: 18 }), hint),
    h('button', { type: 'button', class: 'link-btn', onClick: () => showResults() }, 'Skip the animation and show me'),
  );

  root.append(greet, stage, results);
  return {
    el: root,
    reveal: showResults,
    destroy() {
      for (const fn of cleanups) fn();
    },
  };
}
