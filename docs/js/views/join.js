import { h, mount } from '../lib/dom.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { getJSON, setJSON } from '../lib/storage.js';
import { rememberKey } from '../lib/idb.js';
import { GENERATED_BITS, estimateBits, generatePassphrase } from '../lib/words.js';
import { toB64url } from '../lib/bytes.js';
import { AVATARS } from '../lib/emoji.js';
import { LIMITS, cleanEmail, cleanEmoji, cleanLine, cleanText } from '../core/schema.js';
import { TYPE, decodeInvite, encodeJoin, linkFor } from '../core/payload.js';
import { createParticipantKey, keyId, normalizePassphrase } from '../core/seal.js';
import { applyJoin, loadEvent, previewJoin, saveEvent } from '../core/events.js';
import { navigate } from '../router.js';
import { avatar, button, field, input, notice, spinner, textarea } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { showQrDialog } from '../ui/qr.js';
import { canNativeShare, mailtoHref, nativeShare } from '../ui/share.js';
import { toast } from '../ui/toast.js';
import { linkErrorView } from './reveal.js';

const MIN_CUSTOM_BITS = 36;

function strengthLabel(bits) {
  if (bits >= 50) return ['Strong', 'strong'];
  if (bits >= MIN_CUSTOM_BITS) return ['Good', 'good'];
  if (bits >= 25) return ['Too guessable', 'weak'];
  return ['Too short', 'weak'];
}

function eventSummary(ev) {
  return h(
    'div',
    { class: 'reveal-card join-event' },
    h('p', { class: 'eyebrow' }, 'You’re invited to'),
    h('h1', { class: 'join-title' }, ev.n),
    h(
      'div',
      { class: 'info-rows' },
      ev.d && h('div', { class: 'info-row' }, icon('calendar'), h('div', formatDate(ev.d, ev.t))),
      ev.b !== null && h('div', { class: 'info-row' }, icon('wallet'), h('div', 'Budget: ', h('strong', formatMoney(ev.b, ev.c)))),
      ev.l && h('div', { class: 'info-row' }, icon('map-pin'), h('div', ev.l)),
      ev.o && h('div', { class: 'info-row' }, icon('user'), h('div', 'Organized by ', h('strong', ev.o))),
    ),
    ev.m && h('blockquote', { class: 'organizer-msg' }, ev.m),
  );
}

export default async function joinView({ root, parts }) {
  document.title = 'Join a Secret Santa 🎁';
  let invite;
  try {
    invite = await decodeInvite(parts[1] || '');
  } catch (e) {
    mount(root, linkErrorView(e));
    return;
  }
  const ev = invite.ev;
  const sealed = invite.s;
  document.body.dataset.eventTheme = ev.th;
  const local = loadEvent(ev.id); // organizer's own device?

  let emoji = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const nameIn = input({ maxlength: LIMITS.name, autocomplete: 'given-name', required: true, placeholder: 'Your name' });
  const nameField = field('Your name', nameIn, { hint: 'Use the name everyone knows you by.' });
  const emailIn = input({ type: 'email', maxlength: LIMITS.email, autocomplete: 'email', placeholder: 'you@example.com' });
  const emailField = field('Email', emailIn, { optional: true, hint: 'So the organizer can email you your link.' });
  const wishIn = textarea({ rows: 5, maxlength: LIMITS.wishlist, placeholder: 'One idea per line, e.g.\nWool socks (size M)\nAnything from https://example.com/shop' });
  const notesIn = textarea({ rows: 2, maxlength: LIMITS.notes, placeholder: 'Sizes, allergies, things you definitely don’t want…' });
  const avatarRow = h(
    'div',
    { class: 'emoji-grid compact', role: 'radiogroup', 'aria-label': 'Pick an avatar' },
    AVATARS.slice(0, 24).map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: 'emoji-option',
          role: 'radio',
          'aria-checked': a === emoji ? 'true' : 'false',
          'aria-label': a,
          onClick: (e) => {
            emoji = a;
            for (const b of avatarRow.querySelectorAll('.emoji-option')) b.setAttribute('aria-checked', b === e.currentTarget ? 'true' : 'false');
          },
        },
        a,
      ),
    ),
  );

  // --- Secret phrase (sealed mode)
  let mode = 'generated';
  let generated = generatePassphrase();
  const genText = h('code', { class: 'phrase' }, generated);
  const customIn = input({ type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'At least a few words', 'aria-describedby': 'strength' });
  const meter = h('div', { class: 'meter', id: 'strength', 'aria-live': 'polite' });
  const updateMeter = () => {
    const bits = estimateBits(customIn.value);
    const [label, cls] = strengthLabel(bits);
    meter.className = `meter meter-${cls}`;
    meter.replaceChildren(h('span', { class: 'meter-bar' }, h('span', { class: 'meter-fill', style: { width: `${Math.min(100, (bits / 60) * 100)}%` } })), h('span', { class: 'meter-label' }, customIn.value ? `${label} (≈${bits} bits)` : 'Type a phrase'));
  };
  customIn.addEventListener('input', updateMeter);
  updateMeter();
  const genBox = h(
    'div',
    { class: 'phrase-box' },
    genText,
    h(
      'div',
      { class: 'btn-row' },
      button('New one', {
        size: 'sm',
        variant: 'ghost',
        iconName: 'dice-5',
        onClick: () => {
          generated = generatePassphrase();
          genText.textContent = generated;
        },
      }),
      button('Copy', { size: 'sm', variant: 'ghost', iconName: 'copy', onClick: async () => toast((await copyText(generated)) ? 'Phrase copied' : 'Couldn’t copy', { type: 'success' }) }),
    ),
  );
  const customBox = h('div', { class: 'stack-sm', hidden: true }, customIn, meter);
  const modeRadio = (value, label) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'radio',
        name: 'phrase-mode',
        value,
        checked: value === mode,
        onChange: () => {
          mode = value;
          genBox.hidden = mode !== 'generated';
          customBox.hidden = mode !== 'custom';
          if (mode === 'custom') customIn.focus();
        },
      }),
      ` ${label}`,
    );
  const savedCheck = h('input', { type: 'checkbox', id: 'saved-check' });
  const rememberCheck = h('input', { type: 'checkbox', id: 'remember-check', checked: true });
  const phraseErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });

  const sealedSection = sealed
    ? h(
        'section',
        { class: 'reveal-card stack' },
        h('h2', { class: 'card-title' }, icon('lock'), 'Your secret phrase'),
        h('p', { class: 'muted' }, 'This exchange is sealed: your match will be encrypted so only this phrase can open it. Not even the organizer can peek. Write it down or save it in your password manager.'),
        h('div', { class: 'row gap-md wrap' }, modeRadio('generated', 'Use this generated phrase (recommended)'), modeRadio('custom', 'Choose my own')),
        genBox,
        customBox,
        h('label', { class: 'check', htmlFor: 'saved-check' }, savedCheck, ' I’ve saved my secret phrase somewhere safe'),
        h('label', { class: 'check', htmlFor: 'remember-check' }, rememberCheck, ' Also remember it on this device'),
        phraseErr,
        h('p', { class: 'small muted' }, `Generated phrases have about ${Math.round(GENERATED_BITS)} bits of randomness and are stretched with 600,000 rounds of PBKDF2, so guessing one would take a GPU many months.`),
      )
    : null;

  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, icon('sparkles', { size: 18 }), h('span', local ? 'Add me to the exchange' : 'Sign me up'));
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });

  const form = h(
    'form',
    {
      class: 'stack-lg',
      onSubmit: async (e) => {
        e.preventDefault();
        nameField.setError('');
        emailField.setError('');
        phraseErr.hidden = true;
        const name = cleanLine(nameIn.value, LIMITS.name);
        if (!name) {
          nameField.setError('Please enter your name.');
          nameIn.focus();
          return;
        }
        const email = emailIn.value.trim() ? cleanEmail(emailIn.value) : '';
        if (emailIn.value.trim() && !email) {
          emailField.setError('That doesn’t look like an email address.');
          emailIn.focus();
          return;
        }
        let phrase = '';
        if (sealed) {
          phrase = mode === 'generated' ? generated : customIn.value;
          if (mode === 'custom' && (estimateBits(phrase) < MIN_CUSTOM_BITS || normalizePassphrase(phrase).length < 10)) {
            phraseErr.textContent = 'Please choose a longer, less guessable phrase (or use the generated one).';
            phraseErr.hidden = false;
            customIn.focus();
            return;
          }
          if (!savedCheck.checked) {
            phraseErr.textContent = 'Please save your phrase first. Without it, nobody can open your match.';
            phraseErr.hidden = false;
            savedCheck.focus();
            return;
          }
        }
        submitBtn.disabled = true;
        status.replaceChildren(spinner(), sealed ? ' Creating your encryption key…' : ' Preparing…');
        try {
          const join = {
            e: ev.id,
            n: name,
            a: cleanEmoji(emoji),
            w: cleanText(wishIn.value, LIMITS.wishlist),
            no: cleanText(notesIn.value, LIMITS.notes),
            em: email,
          };
          if (sealed) {
            const key = await createParticipantKey(phrase, ev.id);
            join.k = toB64url(key.pub);
            join.wr = toB64url(key.wrap);
            if (rememberCheck.checked) await rememberKey(`${ev.id}:${await keyId(key.pub)}`, key.privateKey);
          }
          const code = await encodeJoin(join);
          const joined = (getJSON('joined', []) || []).filter((j) => !(j.eventId === ev.id && j.name === name));
          joined.push({ eventId: ev.id, eventName: ev.n, name, at: Date.now() });
          setJSON('joined', joined.slice(-20));
          showDone(join, code, phrase);
        } catch (ex) {
          status.textContent = '';
          toast(ex.message || 'Something went wrong.', { type: 'error' });
        } finally {
          submitBtn.disabled = false;
        }
      },
    },
    h(
      'section',
      { class: 'reveal-card stack' },
      h('h2', { class: 'card-title' }, icon('user'), 'About you'),
      h('div', { class: 'row gap-md align-start' }, h('div', { class: 'grow' }, nameField)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Pick an avatar'), avatarRow),
      emailField,
    ),
    h(
      'section',
      { class: 'reveal-card stack' },
      h('h2', { class: 'card-title' }, icon('list-checks'), 'Your wishlist'),
      field('Gift ideas for your Santa', wishIn, { optional: true, hint: 'Your Secret Santa sees this. Links work too.' }),
      field('Notes for your Santa', notesIn, { optional: true }),
    ),
    sealedSection,
    h('div', { class: 'center stack-sm' }, submitBtn, status),
  );

  function showDone(join, code, phrase) {
    const url = linkFor(TYPE.JOIN, code);
    const text = `🎅 Here's my Secret Santa sign-up for ${ev.n}. Open this link to add me:\n${url}`;
    const addHere = () => {
      const current = loadEvent(ev.id);
      if (!current) return;
      const pv = previewJoin(current, join);
      const res = applyJoin(current, join);
      saveEvent(current);
      toast(res === 'added' ? `Added ${join.n}` : res === 'same' ? 'Already added' : `Updated ${join.n}${pv.keyChange ? ' (new key)' : ''}`, { type: 'success' });
      navigate(`/e/${ev.id}/people`);
    };
    mount(
      root,
      h(
        'div',
        { class: 'container narrow reveal-page stack-lg' },
        h(
          'div',
          { class: 'reveal-greet' },
          avatar(join.a || '🎁', { size: 'xl' }),
          h('h1', { class: 'reveal-hello', tabindex: '-1' }, `You’re in, ${join.n}! 🎉`),
          h('p', { class: 'lead' }, local ? 'You’re the organizer on this device, so you can add yourself right away.' : `One last step: send this to ${ev.o || 'the organizer'} so they can add you.`),
        ),
        local
          ? h('div', { class: 'center' }, button('Add me to the exchange', { variant: 'primary', size: 'lg', iconName: 'user-plus', onClick: addHere }))
          : h(
              'section',
              { class: 'reveal-card stack' },
              h('h2', { class: 'card-title' }, icon('send'), 'Send your sign-up'),
              h('input', { class: 'input mono', readOnly: true, value: url, 'aria-label': 'Your sign-up link', onFocus: (e) => e.target.select() }),
              h(
                'div',
                { class: 'btn-row' },
                canNativeShare() && button('Share…', { variant: 'primary', iconName: 'share-2', onClick: () => nativeShare({ title: `Sign-up: ${join.n}`, text }) }),
                button('Copy', { variant: canNativeShare() ? 'secondary' : 'primary', iconName: 'copy', onClick: async () => toast((await copyText(text)) ? 'Copied! Paste it in a message to the organizer.' : 'Couldn’t copy', { type: 'success' }) }),
                h('a', { class: 'btn btn-secondary', href: mailtoHref('', `Secret Santa sign-up: ${join.n}`, text) }, icon('mail', { size: 18 }), h('span', 'Email')),
                button('QR code', { iconName: 'qr-code', onClick: () => showQrDialog({ title: 'Your sign-up', url, caption: 'The organizer can scan this to add you.' }) }),
              ),
              h('p', { class: 'small muted' }, 'This code only contains what you typed above', sealed ? ' plus your public key and your encrypted private key (useless without your phrase).' : '.'),
            ),
        phrase &&
          notice(
            h('div', h('p', h('strong', 'Your secret phrase: '), h('code', { class: 'phrase' }, phrase)), h('p', { class: 'small' }, 'You’ll need it to open your match. Keep it safe; it can’t be recovered.')),
            'warn',
            'key-round',
          ),
        h('p', { class: 'center muted small' }, 'Your organizer will send you a private link once names are drawn. 🎄'),
      ),
    );
    const heading = root.querySelector('h1');
    if (heading) heading.focus();
    window.scrollTo(0, 0);
  }

  mount(
    root,
    h(
      'div',
      { class: 'container narrow reveal-page stack-lg' },
      eventSummary(ev),
      local && notice('This exchange was created on this device, so you can add yourself directly.', 'info'),
      form,
    ),
  );
}
