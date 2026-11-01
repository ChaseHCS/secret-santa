import { debounce, h, mount } from '../lib/dom.js';
import { plural } from '../lib/format.js';
import { copyText } from '../lib/clipboard.js';
import { AVATARS } from '../lib/emoji.js';
import { normName } from '../core/draw.js';
import { applyJoin, createParticipant, eventDetails, previewJoin } from '../core/events.js';
import { LIMITS, cleanEmail, cleanEmoji, cleanLine, cleanPhone, cleanText } from '../core/schema.js';
import { TYPE, decodeJoin, encodeInvite, findJoinCodes, linkFor } from '../core/payload.js';
import { avatar, badge, button, card, emptyState, field, iconButton, input, notice, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { showQrDialog } from '../ui/qr.js';
import { canNativeShare, nativeShare } from '../ui/share.js';
import { toast } from '../ui/toast.js';

function nameTaken(ev, name, exceptId = null) {
  const n = normName(name);
  return ev.participants.some((p) => p.id !== exceptId && normName(p.name) === n);
}

/** Parse pasted names: one per line (or comma-separated), optionally with an email. */
export function parseNameList(text) {
  let entries = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (entries.length === 1 && entries[0].includes(',') && !/@/.test(entries[0])) {
    entries = entries[0].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return entries
    .map((line) => {
      const em = /[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+/.exec(line);
      const email = em ? cleanEmail(em[0]) : '';
      let name = em ? line.replace(em[0], ' ') : line;
      name = name.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').replace(/[<>()[\]"]/g, ' ').replace(/[\s,;:|-]+$/g, '').replace(/^[\s,;:|-]+/g, '');
      return { name: cleanLine(name, LIMITS.name), email };
    })
    .filter((e) => e.name);
}

function emojiPicker(current, onPick) {
  const grid = h(
    'div',
    { class: 'emoji-grid', role: 'listbox', 'aria-label': 'Avatars' },
    AVATARS.map((a) =>
      h(
        'button',
        {
          type: 'button',
          class: 'emoji-option',
          role: 'option',
          'aria-selected': a === current ? 'true' : 'false',
          'aria-label': a,
          onClick: () => onPick(a),
        },
        a,
      ),
    ),
  );
  return grid;
}

export function editParticipantDialog(ctx, p) {
  const ev = ctx.ev;
  const isNew = !p;
  const data = p ? { ...p } : { name: '', email: '', phone: '', group: '', wishlist: '', notes: '', emoji: '' };
  let emoji = data.emoji || AVATARS[ev.participants.length % AVATARS.length];
  const nameIn = input({ value: data.name, maxlength: LIMITS.name, autocomplete: 'off', required: true });
  const nameField = field('Name', nameIn);
  const emailIn = input({ type: 'email', value: data.email, maxlength: LIMITS.email, autocomplete: 'off', placeholder: 'For emailing their link' });
  const emailField = field('Email', emailIn, { optional: true });
  const phoneIn = input({ type: 'tel', value: data.phone, maxlength: LIMITS.phone, autocomplete: 'off', placeholder: '+1 555 123 4567' });
  const phoneField = field('Phone', phoneIn, { optional: true, hint: 'Include the country code (+44…) to use WhatsApp.' });
  const groups = [...new Set(ev.participants.map((x) => x.group).filter(Boolean))];
  const listId = `groups-${Math.random().toString(36).slice(2)}`;
  const groupIn = input({ value: data.group, maxlength: LIMITS.group, list: listId, autocomplete: 'off', placeholder: 'e.g. The Smiths' });
  const wishIn = textarea({ value: data.wishlist, maxlength: LIMITS.wishlist, rows: 4, placeholder: 'One idea per line. Links work too.' });
  const notesIn = textarea({ value: data.notes, maxlength: LIMITS.notes, rows: 2, placeholder: 'Sizes, allergies, things to avoid…' });
  const avatarBtn = h('button', { type: 'button', class: 'avatar-pick', 'aria-label': 'Change avatar', 'aria-expanded': 'false' }, avatar(emoji, { size: 'lg' }));
  const picker = h('div', { class: 'picker-wrap', hidden: true });
  avatarBtn.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
    avatarBtn.setAttribute('aria-expanded', String(!picker.hidden));
    if (!picker.hidden) {
      mount(
        picker,
        emojiPicker(emoji, (a) => {
          emoji = a;
          mount(avatarBtn, avatar(emoji, { size: 'lg' }));
          picker.hidden = true;
          avatarBtn.setAttribute('aria-expanded', 'false');
          avatarBtn.focus();
        }),
      );
    }
  });

  let removeKey = false;
  const keyNote =
    p && p.key
      ? notice(
          h(
            'div',
            h('p', h('strong', 'Signed up with a secret phrase.'), ' Their link will be sealed so only they can open it.'),
            button('Remove key (use a regular link)', {
              size: 'sm',
              variant: 'ghost',
              onClick: (e) => {
                removeKey = true;
                e.currentTarget.closest('.notice').replaceWith(notice('Key will be removed when you save.', 'warn'));
              },
            }),
          ),
          'info',
          'lock',
        )
      : null;

  const submit = () => {
    const name = cleanLine(nameIn.value, LIMITS.name);
    nameField.setError('');
    emailField.setError('');
    phoneField.setError('');
    if (!name) {
      nameField.setError('Please enter a name.');
      nameIn.focus();
      return false;
    }
    if (nameTaken(ev, name, p ? p.id : null)) {
      nameField.setError('Someone with that name is already in. Add an initial to tell them apart.');
      nameIn.focus();
      return false;
    }
    const email = emailIn.value.trim() ? cleanEmail(emailIn.value) : '';
    if (emailIn.value.trim() && !email) {
      emailField.setError('That doesn’t look like an email address.');
      emailIn.focus();
      return false;
    }
    const phone = phoneIn.value.trim() ? cleanPhone(phoneIn.value) : '';
    if (phoneIn.value.trim() && !phone) {
      phoneField.setError('That doesn’t look like a phone number.');
      phoneIn.focus();
      return false;
    }
    const fields = {
      name,
      email,
      phone,
      group: cleanLine(groupIn.value, LIMITS.group),
      wishlist: cleanText(wishIn.value, LIMITS.wishlist),
      notes: cleanText(notesIn.value, LIMITS.notes),
      emoji: cleanEmoji(emoji) || '🎁',
    };
    ctx.change(
      (e) => {
        if (isNew) {
          e.participants.push(createParticipant(fields, e.participants));
        } else {
          const target = e.participants.find((x) => x.id === p.id);
          if (target) {
            Object.assign(target, fields);
            if (removeKey) target.key = null;
          }
        }
      },
      { rerender: true },
    );
    toast(isNew ? `Added ${name}` : 'Saved', { type: 'success' });
    return true;
  };

  const form = h(
    'form',
    {
      class: 'stack',
      onSubmit: (e) => {
        e.preventDefault();
        if (submit()) dlg.close(true);
      },
    },
    h('div', { class: 'row gap-md align-start' }, avatarBtn, h('div', { class: 'grow' }, nameField)),
    picker,
    keyNote,
    h('div', { class: 'form-grid' }, emailField, phoneField),
    field('Household / group', groupIn, { optional: true, hint: 'People in the same group won’t draw each other (if that rule is on).' }),
    h('datalist', { id: listId }, groups.map((g) => h('option', { value: g }))),
    field('Wishlist', wishIn, { optional: true, hint: 'Shown to whoever draws them.' }),
    field('Notes for their Santa', notesIn, { optional: true }),
    h('button', { type: 'submit', hidden: true }),
  );

  const dlg = openDialog({
    title: isNew ? 'Add someone' : `Edit ${p.name}`,
    body: form,
    actions: [
      { label: 'Cancel', value: false },
      { label: isNew ? 'Add' : 'Save', variant: 'primary', value: true, onClick: () => submit() },
    ],
  });
}

function bulkAddDialog(ctx) {
  const ta = textarea({ rows: 8, placeholder: 'Ann\nBob <bob@example.com>\nCat, cat@example.com\n…' });
  const preview = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const compute = () => {
    const entries = parseNameList(ta.value);
    const seen = new Set();
    const fresh = [];
    let dupes = 0;
    for (const e of entries) {
      const n = normName(e.name);
      if (seen.has(n) || nameTaken(ctx.ev, e.name)) {
        dupes++;
        continue;
      }
      seen.add(n);
      fresh.push(e);
    }
    const room = LIMITS.participants - ctx.ev.participants.length;
    const list = fresh.slice(0, Math.max(0, room));
    preview.textContent = entries.length
      ? `${plural(list.length, 'person', 'people')} will be added${dupes ? ` · ${dupes} already in the list` : ''}${fresh.length > list.length ? ` · ${fresh.length - list.length} over the ${LIMITS.participants}-person limit` : ''}.`
      : 'One name per line. Emails are picked up automatically.';
    return list;
  };
  ta.addEventListener('input', compute);
  compute();
  openDialog({
    title: 'Paste a list of names',
    body: h('div', { class: 'stack' }, field('Names', ta), preview),
    actions: [
      { label: 'Cancel', value: false },
      {
        label: 'Add everyone',
        variant: 'primary',
        onClick: () => {
          const list = compute();
          if (!list.length) {
            ta.focus();
            return false;
          }
          ctx.change(
            (e) => {
              for (const item of list) e.participants.push(createParticipant(item, e.participants));
            },
            { rerender: true },
          );
          toast(`Added ${plural(list.length, 'person', 'people')}`, { type: 'success' });
          return true;
        },
      },
    ],
  });
}

async function signupDialog(ctx) {
  ctx.flush();
  const ev = ctx.ev;
  const data = await encodeInvite({ ev: eventDetails(ev), s: !!ev.sealedMode });
  const url = linkFor(TYPE.INVITE, data);
  const text = `🎁 Join ${ev.name || 'our Secret Santa'}! Sign up and add your wishlist here:\n${url}`;
  const urlBox = h('input', { class: 'input mono', readOnly: true, value: url, 'aria-label': 'Sign-up link', onFocus: (e) => e.target.select() });
  openDialog({
    title: 'Invite people to sign up',
    body: h(
      'div',
      { class: 'stack' },
      h('p', 'Share this link (group chat, email, Slack…). Each person enters their name and wishlist, then sends you back a code. Paste the codes into ', h('strong', 'Import sign-ups'), ' or open them on this device.'),
      ev.sealedMode
        ? notice('Sealed mode is on, so everyone also picks a secret phrase. Their match will be encrypted so only they can read it.', 'info', 'lock')
        : notice('Want matches nobody else can peek at? Turn on sealed mode in Details before sharing this link.', 'info', 'lock'),
      !ev.name && notice('Tip: give your exchange a name first so people know what they’re joining.', 'warn'),
      urlBox,
      h(
        'div',
        { class: 'btn-row' },
        button('Copy link', {
          iconName: 'copy',
          variant: 'primary',
          onClick: async () => toast((await copyText(url)) ? 'Sign-up link copied' : 'Couldn’t copy', { type: 'success' }),
        }),
        canNativeShare() && button('Share…', { iconName: 'share-2', onClick: () => nativeShare({ title: ev.name || 'Secret Santa', text }) }),
        button('QR code', { iconName: 'qr-code', onClick: () => showQrDialog({ title: 'Sign-up link', url, filename: `${ev.name || 'secret-santa'}-signup` }) }),
      ),
    ),
    actions: [{ label: 'Done', value: true, variant: 'secondary' }],
  });
}

export function importSignupsDialog(ctx, initial = '') {
  const ta = textarea({ rows: 6, value: initial, placeholder: 'Paste one or more sign-up codes or links here…', class: 'input textarea mono' });
  const results = h('div', { class: 'import-results', 'aria-live': 'polite' });
  let decoded = [];
  let latest = Promise.resolve();
  let runId = 0;
  const decodeAll = async () => {
    const mine = ++runId;
    const codes = findJoinCodes(ta.value);
    const out = [];
    for (const c of codes) {
      try {
        const j = await decodeJoin(c);
        out.push({ j, pv: previewJoin(ctx.ev, j) });
      } catch (e) {
        out.push({ error: e.message });
      }
    }
    if (mine !== runId) return;
    decoded = out;
    mount(
      results,
      out.length
        ? h(
            'ul',
            { class: 'import-list' },
            out.map((r) => {
              if (r.error) return h('li', { class: 'bad' }, icon('circle-alert', { size: 16 }), r.error);
              const { j, pv } = r;
              const label = {
                new: ['New', 'success'],
                update: ['Updates existing', 'info'],
                same: ['Already imported', 'neutral'],
                'wrong-event': ['For a different exchange', 'error'],
                full: ['Exchange is full', 'error'],
              }[pv.status];
              return h(
                'li',
                { class: pv.status === 'wrong-event' || pv.status === 'full' ? 'bad' : '' },
                h('span', { class: 'import-name' }, `${j.a || '🎁'} ${j.n}`),
                badge(label[0], label[1]),
                j.k && badge('Sealed key', 'neutral', 'lock'),
                pv.keyChange && h('p', { class: 'warn-text small' }, icon('triangle-alert', { size: 14 }), ` Replaces ${j.n}’s existing secret-phrase key. Only import this if ${j.n} sent it to you.`),
              );
            }),
          )
        : ta.value.trim()
          ? h('p', { class: 'muted small' }, 'No sign-up codes found in that text.')
          : null,
    );
  };
  const run = debounce(() => {
    latest = decodeAll();
  }, 200);
  ta.addEventListener('input', run);
  if (initial) run.flush();
  openDialog({
    title: 'Import sign-ups',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Paste the messages people sent you after signing up. Everything is checked before it’s added.'), field('Sign-up codes', ta), results),
    actions: [
      { label: 'Cancel', value: false },
      {
        label: 'Import',
        variant: 'primary',
        onClick: async () => {
          run.flush();
          await latest;
          // A newer run may still be in flight if the text changed again.
          await latest;
          const usable = decoded.filter((r) => r.j && ['new', 'update'].includes(r.pv.status));
          if (!usable.length) {
            toast('Nothing new to import.', { type: 'warn' });
            return false;
          }
          let added = 0;
          let updated = 0;
          ctx.change(
            (e) => {
              for (const { j } of usable) {
                const res = applyJoin(e, j);
                if (res === 'added') added++;
                if (res === 'updated') updated++;
              }
            },
            { rerender: true },
          );
          toast([added && `Added ${added}`, updated && `updated ${updated}`].filter(Boolean).join(', ') || 'Nothing changed', { type: 'success' });
          return true;
        },
      },
    ],
  });
}

function participantRow(ctx, p) {
  const ev = ctx.ev;
  const sub = [p.group && `🏠 ${p.group}`, p.email, p.phone].filter(Boolean).join(' · ');
  const remove = () => {
    const index = ev.participants.findIndex((x) => x.id === p.id);
    if (index < 0) return;
    const removedEx = ev.rules.exclusions.filter((x) => x.from === p.id || x.to === p.id);
    const snapshot = ev.participants[index];
    ctx.change(
      (e) => {
        e.participants.splice(index, 1);
        e.rules.exclusions = e.rules.exclusions.filter((x) => x.from !== p.id && x.to !== p.id);
      },
      { rerender: true },
    );
    toast(`Removed ${p.name}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          ctx.change(
            (e) => {
              if (e.participants.some((x) => x.id === snapshot.id)) return;
              e.participants.splice(Math.min(index, e.participants.length), 0, snapshot);
              e.rules.exclusions.push(...removedEx);
            },
            { rerender: true },
          );
        },
      },
    });
  };
  return h(
    'li',
    { class: 'person' },
    h(
      'button',
      {
        type: 'button',
        class: 'person-avatar',
        'aria-label': `Change ${p.name}’s avatar`,
        onClick: () => {
          const dlg = openDialog({
            title: `Pick an avatar for ${p.name}`,
            size: 'sm',
            body: emojiPicker(p.emoji, (a) => {
              ctx.change((e) => {
                const t = e.participants.find((x) => x.id === p.id);
                if (t) t.emoji = a;
              }, { rerender: true });
              dlg.close();
            }),
          });
        },
      },
      avatar(p.emoji),
    ),
    h(
      'div',
      { class: 'person-main' },
      h('span', { class: 'person-name' }, p.name),
      sub && h('span', { class: 'person-sub' }, sub),
      h(
        'span',
        { class: 'person-badges' },
        p.key && badge('Sealed', 'info', 'lock'),
        p.source === 'signup' && !p.key && badge('Signed up', 'neutral', 'user-plus'),
        p.wishlist && badge('Wishlist', 'success', 'list-checks'),
      ),
    ),
    h('div', { class: 'person-actions' }, iconButton('pencil', `Edit ${p.name}`, () => editParticipantDialog(ctx, p)), iconButton('trash', `Remove ${p.name}`, remove, { className: 'danger' })),
  );
}

export default function peopleStep(ctx) {
  const ev = ctx.ev;
  const nameIn = input({ placeholder: 'Type a name and press Enter', maxlength: LIMITS.name, autocomplete: 'off', 'aria-label': 'Name', enterkeyhint: 'done', autocapitalize: 'words' });
  const err = h('p', { class: 'field-error', hidden: true, id: 'add-err' });
  const listEl = h('div');

  const renderList = () => {
    const n = ev.participants.length;
    mount(
      listEl,
      n
        ? h(
            'div',
            null,
            h('div', { class: 'list-head' }, h('h2', { class: 'card-title' }, icon('users'), `People (${n})`), n < 3 && h('span', { class: 'muted small' }, n === 2 ? 'Add one more for a proper exchange.' : 'Add at least 2 more.')),
            h('ul', { class: 'people-list' }, ev.participants.map((p) => participantRow(ctx, p))),
          )
        : emptyState({ emoji: '👥', title: 'No one here yet', text: 'Add names above, paste a whole list, or send a sign-up link so people can add themselves (and their wishlists).' }),
    );
  };

  const addOne = () => {
    const name = cleanLine(nameIn.value, LIMITS.name);
    err.hidden = true;
    nameIn.setAttribute('aria-invalid', 'false');
    if (!name) return;
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
      nameIn.setAttribute('aria-invalid', 'true');
      nameIn.setAttribute('aria-errormessage', 'add-err');
    };
    if (nameTaken(ev, name)) return fail(`${name} is already on the list.`);
    if (ev.participants.length >= LIMITS.participants) return fail(`That’s the maximum of ${LIMITS.participants} people.`);
    ctx.change((e) => e.participants.push(createParticipant({ name }, e.participants)));
    nameIn.value = '';
    renderList();
    nameIn.focus();
    return undefined;
  };

  const form = h(
    'form',
    {
      class: 'add-form',
      onSubmit: (e) => {
        e.preventDefault();
        addOne();
      },
    },
    nameIn,
    h('button', { type: 'submit', class: 'btn btn-primary' }, icon('user-plus', { size: 18 }), h('span', 'Add')),
  );

  renderList();
  const drawn = !!ev.draw;
  return h(
    'div',
    { class: 'stack-lg' },
    drawn && notice('Names have already been drawn. Adding or removing people means you’ll need to draw again.', 'warn'),
    card(
      h(
        'div',
        { class: 'stack' },
        form,
        err,
        h(
          'div',
          { class: 'btn-row' },
          button('Paste a list', { iconName: 'clipboard-list', size: 'sm', onClick: () => bulkAddDialog(ctx) }),
          button('Add with details', { iconName: 'notebook-pen', size: 'sm', onClick: () => editParticipantDialog(ctx, null) }),
          button('Get a sign-up link', { iconName: 'link', size: 'sm', onClick: () => signupDialog(ctx) }),
          button('Import sign-ups', { iconName: 'file-down', size: 'sm', onClick: () => importSignupsDialog(ctx) }),
        ),
        ev.sealedMode && !ev.participants.some((p) => p.key) && notice('Sealed mode is on. People need to sign up with the sign-up link to get sealed links; anyone added here by hand gets a regular link.', 'info', 'lock'),
      ),
      { title: 'Add people', titleIcon: 'user-plus' },
    ),
    card(listEl, { className: 'people-card' }),
    ev.participants.length > 0 && h('p', { class: 'muted small' }, icon('lightbulb', { size: 16 }), ' Tip: put partners and families in the same household (Edit → Household). On the Rules step they’ll be kept from drawing each other.'),
  );
}
