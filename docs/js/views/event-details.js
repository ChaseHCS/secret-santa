import { h } from '../lib/dom.js';
import { LIMITS, cleanBudget, cleanCurrency, cleanDate, cleanLine, cleanText, cleanTime } from '../core/schema.js';
import { CURRENCIES } from '../data/currencies.js';
import { card, field, input, radioCards, select, textarea, toggle } from '../ui/components.js';
import { icon } from '../ui/icons.js';

export const STYLE_OPTIONS = [
  { value: 'giftbox', emoji: '🎁', label: 'Gift box', description: 'Tap to unwrap' },
  { value: 'scratch', emoji: '🪙', label: 'Scratch card', description: 'Scratch to reveal' },
  { value: 'envelope', emoji: '✉️', label: 'Envelope', description: 'Break the seal' },
];

export const THEME_OPTIONS = [
  { value: 'classic', label: 'Classic', swatch: true },
  { value: 'frost', label: 'Frost', swatch: true },
  { value: 'candy', label: 'Candy cane', swatch: true },
  { value: 'evergreen', label: 'Evergreen', swatch: true },
  { value: 'midnight', label: 'Midnight', swatch: true },
];

function nextDate(month, day) {
  const now = new Date();
  let y = now.getFullYear();
  const target = new Date(y, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (target < today) y += 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function detailsStep(ctx) {
  const ev = ctx.ev;
  const bind = (el, apply) => {
    el.addEventListener('input', () => ctx.change((e) => apply(e, el.value)));
    return el;
  };

  const name = bind(
    input({ value: ev.name, maxlength: LIMITS.eventName, placeholder: 'e.g. Family Christmas 2026', autocomplete: 'off', required: true }),
    (e, v) => {
      e.name = cleanLine(v, LIMITS.eventName);
    },
  );
  const date = input({ type: 'date', value: ev.date, min: '2000-01-01', max: '2200-12-31' });
  date.addEventListener('change', () => ctx.change((e) => (e.date = cleanDate(date.value))));
  date.addEventListener('input', () => ctx.change((e) => (e.date = cleanDate(date.value))));
  const time = input({ type: 'time', value: ev.time, step: 300 });
  time.addEventListener('input', () => ctx.change((e) => (e.time = cleanTime(time.value))));
  time.addEventListener('change', () => ctx.change((e) => (e.time = cleanTime(time.value))));

  const quick = (label, value) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        onClick: () => {
          date.value = value;
          ctx.change((e) => (e.date = cleanDate(value)));
        },
      },
      label,
    );

  const budget = bind(
    input({ type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: ev.budget === null ? '' : String(ev.budget), placeholder: 'e.g. 25' }),
    (e, v) => {
      e.budget = cleanBudget(v);
    },
  );
  const currencyOptions = CURRENCIES.some(([c]) => c === ev.currency) ? CURRENCIES : [[ev.currency, ev.currency], ...CURRENCIES];
  const currency = select(
    currencyOptions.map(([c, label]) => [c, `${c} · ${label}`]),
    ev.currency,
  );
  currency.addEventListener('change', () => ctx.change((e) => (e.currency = cleanCurrency(currency.value))));

  const location = bind(input({ value: ev.location, maxlength: LIMITS.location, placeholder: 'e.g. Grandma’s house, or Zoom' }), (e, v) => {
    e.location = cleanLine(v, LIMITS.location);
  });
  const organizer = bind(input({ value: ev.organizer, maxlength: LIMITS.organizer, placeholder: 'Your name', autocomplete: 'name' }), (e, v) => {
    e.organizer = cleanLine(v, LIMITS.organizer);
  });
  const message = bind(
    textarea({ value: ev.message, maxlength: LIMITS.message, rows: 3, placeholder: 'e.g. Ugly sweaters encouraged! Gifts get opened after dinner.' }),
    (e, v) => {
      e.message = cleanText(v, LIMITS.message);
    },
  );

  return h(
    'div',
    { class: 'stack-lg' },
    card(
      h(
        'div',
        { class: 'form-grid' },
        field('Exchange name', name, { className: 'span-2' }),
        h(
          'div',
          { class: 'span-2 date-row' },
          field('Date', date, { optional: true }),
          field('Time', time, { optional: true }),
        ),
        h(
          'div',
          { class: 'span-2 chips' },
          quick('🎄 Christmas Eve', nextDate(12, 24)),
          quick('🎅 Christmas Day', nextDate(12, 25)),
          quick('🎆 New Year’s Eve', nextDate(12, 31)),
          h(
            'button',
            {
              type: 'button',
              class: 'chip chip-ghost',
              onClick: () => {
                date.value = '';
                time.value = '';
                ctx.change((e) => {
                  e.date = '';
                  e.time = '';
                });
              },
            },
            'Clear date',
          ),
        ),
        h('div', { class: 'budget-row' }, field('Budget', budget, { optional: true, hint: 'Per gift.' }), field('Currency', currency)),
        field('Organizer', organizer, { optional: true, hint: 'Shown to everyone as the host.' }),
        field('Location', location, { optional: true, className: 'span-2' }),
        field('Message for everyone', message, { optional: true, className: 'span-2', hint: 'Shown on everyone’s reveal page.' }),
      ),
      { title: 'The basics', titleIcon: 'pencil' },
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted' }, 'How should people discover their match?'),
        radioCards('reveal-style', STYLE_OPTIONS, ev.revealStyle, (v) => ctx.change((e) => (e.revealStyle = v)), { label: 'Reveal style' }),
        h('p', { class: 'muted' }, 'Color theme for the reveal page:'),
        radioCards('theme', THEME_OPTIONS, ev.theme, (v) => ctx.change((e) => (e.theme = v)), { className: 'theme-cards', label: 'Theme' }),
        h('p', h('a', { href: `#/preview/${ev.id}`, class: 'inline-link', onClick: () => ctx.flush() }, icon('eye', { size: 16 }), 'Preview what participants will see')),
      ),
      { title: 'The big reveal', titleIcon: 'party-popper' },
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        toggle({
          label: 'Sealed mode: even the organizer can’t peek',
          description:
            'Participants sign up with a link and choose a secret phrase. Their match is end-to-end encrypted to them, so you (or anyone holding the links) can’t open it. Anyone you add by hand still gets a regular link.',
          iconName: 'lock',
          checked: ev.sealedMode,
          onChange: (v) => ctx.change((e) => (e.sealedMode = v), { rerender: true }),
        }),
        ev.sealedMode &&
          h(
            'ol',
            { class: 'mini-steps' },
            h('li', 'On the ', h('strong', 'People'), ' step, share the sign-up link.'),
            h('li', 'Each person signs up, picks a secret phrase, and sends you back a code.'),
            h('li', 'Import the codes, then draw. Their links only open with their phrase.'),
          ),
        h('p', { class: 'small muted' }, h('a', { href: '#/about', class: 'inline-link' }, 'How the encryption works →')),
      ),
      { title: 'Privacy', titleIcon: 'shield-check' },
    ),
  );
}
