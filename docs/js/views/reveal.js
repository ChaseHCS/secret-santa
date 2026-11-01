import { h, mount } from '../lib/dom.js';
import { recallKey, rememberKey, forgetKey } from '../lib/idb.js';
import { LinkError, decodeReveal, decodeRevealBytes, decodeSealed, headerAad } from '../core/payload.js';
import { WrongPassphraseError, keyId, open, unwrapParticipantKey } from '../core/seal.js';
import { eventDetails, loadEvent } from '../core/events.js';
import { takePendingEvent } from '../router.js';
import { button, linkButton, notice, spinner } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { revealExperience } from '../ui/reveal.js';
import { toast } from '../ui/toast.js';

const GENERIC_TITLE = 'Your Secret Santa match 🎁';

export function linkErrorView(err) {
  const msg = err instanceof LinkError ? err.message : 'This link couldn’t be opened.';
  return h(
    'div',
    { class: 'container narrow page-pad center link-error' },
    h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, '🧩'),
    h('h1', 'Hmm, this link didn’t work'),
    h('p', { class: 'lead' }, msg),
    h(
      'ul',
      { class: 'tips' },
      h('li', 'Some apps cut long links short. Make sure you opened the entire link.'),
      h('li', 'Try copying the link and pasting it straight into your browser.'),
      h('li', 'Ask the organizer to send it again, or to show you a QR code.'),
    ),
    linkButton('Go to the home page', '#/', { variant: 'secondary' }),
  );
}

function loading(text = 'Opening your link…') {
  return h('div', { class: 'container narrow page-pad center' }, spinner(text), h('p', { class: 'muted' }, text));
}

function mountReveal(root, reveal, opts = {}) {
  document.body.dataset.eventTheme = reveal.ev.th;
  const exp = revealExperience(reveal, opts);
  mount(root, h('div', { class: 'container narrow reveal-page' }, opts.banner || null, exp.el, opts.footer || null));
  return () => exp.destroy();
}

export async function revealRoute({ root, parts }) {
  document.title = GENERIC_TITLE;
  mount(root, loading());
  try {
    const reveal = await decodeReveal(parts[1] || '');
    return mountReveal(root, reveal);
  } catch (e) {
    mount(root, linkErrorView(e));
    return undefined;
  }
}

/**
 * Sealed-link unlock form. Calls onUnlocked(reveal, {remembered}) once decrypted.
 * In party mode the device is shared, so remembered keys are never used or stored.
 */
export function sealedUnlock(sealed, { party = false, onUnlocked }) {
  const { header } = sealed;
  const wrap = h('div', { class: 'unlock' });
  const pass = h('input', {
    type: 'password',
    class: 'input pass-input',
    id: 'unlock-pass',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'e.g. jolly-reindeer-tinsel-cocoa-42',
    required: true,
  });
  const showBtn = h('button', { type: 'button', class: 'icon-btn pass-toggle', 'aria-label': 'Show phrase', 'aria-pressed': 'false' }, icon('eye'));
  showBtn.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    showBtn.setAttribute('aria-pressed', String(show));
    showBtn.setAttribute('aria-label', show ? 'Hide phrase' : 'Show phrase');
    showBtn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
  });
  const remember = h('input', { type: 'checkbox', id: 'unlock-remember', checked: true });
  const err = h('p', { class: 'field-error', id: 'unlock-err', hidden: true, role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, icon('lock-open', { size: 18 }), h('span', 'Unlock my match'));
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  let kidPromise = keyId(header.pub);

  const form = h(
    'form',
    {
      class: 'unlock-form stack',
      onSubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!pass.value.trim()) {
          err.textContent = 'Enter your secret phrase.';
          err.hidden = false;
          pass.focus();
          return;
        }
        submit.disabled = true;
        status.replaceChildren(spinner(), ' Unlocking… (this takes a second on purpose, to slow down guessing)');
        try {
          const key = await unwrapParticipantKey(sealed.wrap, pass.value, header.e);
          const plain = await open(sealed.sealedBox, key, header.pub, headerAad(sealed.headerBytes));
          const reveal = await decodeRevealBytes(plain);
          if (!party && remember.checked) await rememberKey(`${header.e}:${await kidPromise}`, key);
          pass.value = '';
          onUnlocked(reveal, { remembered: !party && remember.checked });
        } catch (ex) {
          status.textContent = '';
          err.textContent =
            ex instanceof WrongPassphraseError
              ? 'That phrase doesn’t match. Phrases aren’t case-sensitive, and spaces and dashes count as the same.'
              : ex.message || 'Couldn’t unlock this link.';
          err.hidden = false;
          pass.setAttribute('aria-invalid', 'true');
          pass.setAttribute('aria-errormessage', 'unlock-err');
          pass.focus();
          pass.select();
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('label', { class: 'field-label', htmlFor: 'unlock-pass' }, 'Your secret phrase'),
    h('div', { class: 'pass-wrap' }, pass, showBtn),
    err,
    !party && h('label', { class: 'check', htmlFor: 'unlock-remember' }, remember, ' Remember on this device (skip the phrase next time)'),
    submit,
    status,
  );

  wrap.append(
    h(
      'div',
      { class: 'reveal-greet' },
      h('p', { class: 'eyebrow' }, header.en),
      h('h1', { class: 'reveal-hello' }, `Hi ${header.g}! `, h('span', { 'aria-hidden': 'true' }, header.ga || '🔐')),
      h('p', { class: 'lead' }, 'Your match is sealed. Only the secret phrase you chose when you signed up can open it.'),
    ),
    h('div', { class: 'reveal-card unlock-card' }, h('div', { class: 'lock-art', 'aria-hidden': 'true' }, '🔐'), form),
    h('p', { class: 'muted small center' }, 'Forgot it? Ask the organizer. They’ll have to draw names again, because nobody (not even them) can recover a sealed match.'),
  );
  return { el: wrap, kidPromise };
}

export async function sealedRoute({ root, parts }) {
  document.title = GENERIC_TITLE;
  let sealed;
  try {
    sealed = decodeSealed(parts[1] || '');
  } catch (e) {
    mount(root, linkErrorView(e));
    return undefined;
  }
  document.body.dataset.eventTheme = sealed.header.th;
  let cleanup = null;

  const show = (reveal, { remembered }) => {
    const footer = remembered
      ? h(
          'p',
          { class: 'center small muted' },
          icon('key-round', { size: 14 }),
          ' Your key is remembered on this device. ',
          h(
            'button',
            {
              type: 'button',
              class: 'link-btn',
              onClick: async (e) => {
                await forgetKey(`${sealed.header.e}:${await keyId(sealed.header.pub)}`);
                e.target.closest('p').textContent = 'Forgotten. You’ll need your phrase next time.';
                toast('Key forgotten on this device', { type: 'success' });
              },
            },
            'Forget it',
          ),
        )
      : null;
    cleanup = mountReveal(root, reveal, { footer });
  };

  // Try a key remembered on this device first.
  mount(root, loading('Checking for a remembered key…'));
  const kid = await keyId(sealed.header.pub);
  const remembered = await recallKey(`${sealed.header.e}:${kid}`);
  if (remembered) {
    try {
      const plain = await open(sealed.sealedBox, remembered, sealed.header.pub, headerAad(sealed.headerBytes));
      show(await decodeRevealBytes(plain), { remembered: true });
      return () => cleanup && cleanup();
    } catch {
      /* fall through to the phrase form */
    }
  }
  if (!root.isConnected) return undefined;
  const form = sealedUnlock(sealed, { onUnlocked: show });
  mount(root, h('div', { class: 'container narrow reveal-page' }, form.el));
  const input = root.querySelector('#unlock-pass');
  if (input) input.focus();
  return () => cleanup && cleanup();
}

export function previewRoute({ root, parts }) {
  const ev = loadEvent(parts[1]) || takePendingEvent(parts[1]);
  document.title = 'Preview · Secret Santa';
  if (!ev) {
    mount(root, linkErrorView(new LinkError('That exchange isn’t saved in this browser.')));
    return undefined;
  }
  const reveal = {
    ev: { ...eventDetails(ev), n: ev.name || 'Your exchange' },
    g: 'there',
    ga: '👋',
    r: 'Rudolph (example)',
    ra: '🦌',
    w: 'Red nose polish\nA really good map of the North Pole\nhttps://en.wikipedia.org/wiki/Rudolph_the_Red-Nosed_Reindeer',
    no: 'Example notes: sizes, allergies and things to avoid show up here.',
    v: null,
  };
  const banner = notice(
    h('div', h('strong', 'Preview with example names. '), 'This is what each person sees when they open their link. ', h('a', { href: `#/e/${ev.id}/details`, class: 'inline-link' }, 'Back to editing')),
    'info',
    'eye',
  );
  const again = h('p', { class: 'center' }, button('Play it again', { iconName: 'rotate-ccw', variant: 'ghost', onClick: () => window.dispatchEvent(new HashChangeEvent('hashchange')) }));
  return mountReveal(root, reveal, { banner, footer: again, preview: true });
}
