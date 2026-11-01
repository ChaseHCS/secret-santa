import { h, mount } from '../lib/dom.js';
import { copyText } from '../lib/clipboard.js';
import { getJSON, setJSON } from '../lib/storage.js';
import { AVATARS } from '../lib/emoji.js';
import { richText, wishlistList } from '../lib/linkify.js';
import { LIMITS, cleanEmoji, cleanLine, cleanText } from '../core/schema.js';
import { TYPE, decodeWishlist, encodeWishlist, linkFor } from '../core/payload.js';
import { avatar, button, field, input, linkButton, textarea } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { showQrDialog } from '../ui/qr.js';
import { canNativeShare, nativeShare } from '../ui/share.js';
import { toast } from '../ui/toast.js';
import { linkErrorView } from './reveal.js';

export function wishlistBuilder({ root }) {
  document.title = 'Make a wishlist · Secret Santa';
  const draft = getJSON('wishlist-draft', {}) || {};
  let emoji = cleanEmoji(draft.a) || AVATARS[0];
  const nameIn = input({ value: draft.n || '', maxlength: LIMITS.name, placeholder: 'Your name', autocomplete: 'given-name' });
  const nameField = field('Your name', nameIn);
  const wishIn = textarea({ value: draft.w || '', rows: 7, maxlength: LIMITS.wishlist, placeholder: 'One idea per line, e.g.\nA cozy blanket\nhttps://example.com/the-exact-mug' });
  const notesIn = textarea({ value: draft.no || '', rows: 2, maxlength: LIMITS.notes, placeholder: 'Sizes, favorite colors, allergies…' });
  const out = h('div', { 'aria-live': 'polite' });
  const counter = h('span', { class: 'muted small' });
  const save = () => {
    setJSON('wishlist-draft', { n: nameIn.value, a: emoji, w: wishIn.value, no: notesIn.value });
    counter.textContent = `${wishIn.value.length}/${LIMITS.wishlist}`;
  };
  for (const el of [nameIn, wishIn, notesIn]) el.addEventListener('input', save);
  save();
  const avatarBtn = h('button', { type: 'button', class: 'avatar-pick', 'aria-label': 'Change avatar' }, avatar(emoji, { size: 'lg' }));
  avatarBtn.addEventListener('click', () => {
    emoji = AVATARS[(AVATARS.indexOf(emoji) + 1) % AVATARS.length];
    mount(avatarBtn, avatar(emoji, { size: 'lg' }));
    save();
  });

  const create = async () => {
    nameField.setError('');
    const n = cleanLine(nameIn.value, LIMITS.name);
    if (!n) {
      nameField.setError('Please enter your name.');
      nameIn.focus();
      return;
    }
    const data = await encodeWishlist({ n, a: cleanEmoji(emoji), w: cleanText(wishIn.value, LIMITS.wishlist), no: cleanText(notesIn.value, LIMITS.notes) });
    const url = linkFor(TYPE.WISHLIST, data);
    mount(
      out,
      h(
        'section',
        { class: 'card stack' },
        h('h2', { class: 'card-title' }, icon('link'), 'Your wishlist link'),
        h('input', { class: 'input mono', readOnly: true, value: url, 'aria-label': 'Wishlist link', onFocus: (e) => e.target.select() }),
        h(
          'div',
          { class: 'btn-row' },
          button('Copy link', { variant: 'primary', iconName: 'copy', onClick: async () => toast((await copyText(url)) ? 'Link copied' : 'Couldn’t copy', { type: 'success' }) }),
          canNativeShare() && button('Share…', { iconName: 'share-2', onClick: () => nativeShare({ title: `${n}’s wishlist`, text: `🎁 My wishlist: ${url}` }) }),
          button('QR code', { iconName: 'qr-code', onClick: () => showQrDialog({ title: `${n}’s wishlist`, url }) }),
          linkButton('Preview', `#/w/${data}`, { iconName: 'eye' }),
        ),
        h('p', { class: 'small muted' }, 'The whole wishlist lives inside this link. Edit and create a new link any time.'),
      ),
    );
    out.querySelector('input').focus();
  };

  mount(
    root,
    h(
      'div',
      { class: 'container narrow page-pad stack-lg' },
      h('div', { class: 'page-head' }, h('h1', 'Make a wishlist link 📝'), h('p', { class: 'lead' }, 'Write your wishlist once and share it with anyone, whether for this Secret Santa or birthdays. No account needed.')),
      h(
        'section',
        { class: 'card stack' },
        h('div', { class: 'row gap-md align-start' }, avatarBtn, h('div', { class: 'grow' }, nameField)),
        field('Wishlist', wishIn, { hint: 'One idea per line. Links become clickable.' }),
        h('div', { class: 'right' }, counter),
        field('Notes', notesIn, { optional: true }),
        h('div', { class: 'btn-row' }, button('Create link', { variant: 'primary', iconName: 'sparkles', onClick: create })),
      ),
      out,
    ),
  );
}

export async function wishlistViewer({ root, parts }) {
  document.title = 'Wishlist · Secret Santa';
  let w;
  try {
    w = await decodeWishlist(parts[1] || '');
  } catch (e) {
    mount(root, linkErrorView(e));
    return;
  }
  document.title = `${w.n}’s wishlist · Secret Santa`;
  mount(
    root,
    h(
      'div',
      { class: 'container narrow page-pad stack-lg' },
      h('div', { class: 'center stack-sm' }, avatar(w.a || '🎁', { size: 'xl' }), h('h1', `${w.n}’s wishlist`)),
      h('section', { class: 'reveal-card wish-card' }, w.w ? wishlistList(w.w) : h('p', { class: 'muted' }, 'This wishlist is empty. A surprise it is!'), w.no && h('div', { class: 'notes' }, h('h4', icon('notebook-pen', { size: 16 }), 'Notes'), richText(w.no))),
      h('div', { class: 'btn-row center-row' }, linkButton('Gift ideas', '#/ideas', { iconName: 'lightbulb' }), linkButton('Make my own wishlist', '#/wishlist', { variant: 'primary', iconName: 'list-checks' })),
    ),
  );
}
