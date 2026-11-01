import { cx, h, mount, prefersReducedMotion, wait } from '../lib/dom.js';
import { formatDate, formatMoney, plural, timeAgo } from '../lib/format.js';
import { copyText, downloadFile, safeFilename } from '../lib/clipboard.js';
import { fromB64url } from '../lib/bytes.js';
import { analyze, describeProblem } from '../core/draw.js';
import { drawStatus, makeDraw, refreshDraw } from '../core/events.js';
import { fingerprint } from '../core/merkle.js';
import { TYPE, linkFor } from '../core/payload.js';
import { DEFAULT_TEMPLATE, PLACEHOLDERS, SEALED_NOTE, renderTemplate } from '../core/template.js';
import { LIMITS, cleanText } from '../core/schema.js';
import { avatar, badge, button, card, iconButton, linkButton, notice, textarea } from '../ui/components.js';
import { alertDialog, confirmDialog, openDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { showQrDialog } from '../ui/qr.js';
import { canNativeShare, mailtoHref, nativeShare, smsHref, whatsappHref } from '../ui/share.js';
import { toast } from '../ui/toast.js';
import { confetti } from '../fx/confetti.js';
import { playJingle, playTick } from '../fx/sound.js';

export function entryUrl(entry) {
  return linkFor(entry.sealed ? TYPE.SEALED : TYPE.REVEAL, entry.link);
}

export function messageFor(ev, p, url) {
  return renderTemplate(ev.template, {
    name: p.name,
    event: ev.name || 'our Secret Santa',
    link: url,
    date: formatDate(ev.date, ev.time),
    budget: ev.budget !== null ? formatMoney(ev.budget, ev.currency) : '',
    organizer: ev.organizer,
    sealed: ev.draw && ev.draw.entries[p.id] && ev.draw.entries[p.id].sealed ? SEALED_NOTE : '',
  });
}

function setSent(ctx, id, value) {
  ctx.change((e) => {
    const entry = e.draw && e.draw.entries[id];
    if (entry) entry.sentAt = value ? Date.now() : 0;
  });
}

// ---------------------------------------------------------------------------
// Drawing

async function shuffleAnimation(names) {
  const label = h('div', { class: 'shuffle-name' }, names[0] || '');
  const overlay = h(
    'div',
    { class: 'shuffle-overlay', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'shuffle-card' }, h('div', { class: 'shuffle-hat', 'aria-hidden': 'true' }, '🎩'), label, h('p', { class: 'muted' }, 'Shuffling names…')),
  );
  document.body.append(overlay);
  if (!prefersReducedMotion()) {
    for (let i = 0; i < 16; i++) {
      label.textContent = names[(Math.random() * names.length) | 0];
      label.classList.remove('flip');
      void label.offsetWidth;
      label.classList.add('flip');
      playTick(1 + i / 20);
      await wait(45 + i * 6);
    }
  }
  return () => overlay.remove();
}

export async function runDraw(ctx) {
  const ev = ctx.ev;
  if (ev.draw) {
    const ok = await confirmDialog({
      title: 'Draw names again?',
      message:
        'Everyone gets a new match and a new link. Old links still open but show the old match, so tell people to use only the new one. The new draw has a different fingerprint, which makes it easy to check.',
      confirmLabel: 'Draw again',
      danger: true,
    });
    if (!ok) return;
  }
  ctx.flush();
  const done = await shuffleAnimation(ev.participants.map((p) => p.name));
  let res;
  try {
    await wait(20);
    res = await makeDraw(ev);
  } catch (e) {
    done();
    alertDialog({ title: 'Something went wrong', message: e.message || String(e) });
    return;
  }
  done();
  if (!res.ok) {
    alertDialog({ title: 'Couldn’t draw names', message: describeProblem(res.problem, ev.participants.map((p) => p.name)) });
    return;
  }
  ctx.change(
    (e) => {
      e.draw = res.draw;
      e.party = { viewed: {} };
    },
    { rerender: true },
  );
  ctx.flush(); // a fresh draw is too important to leave in the debounce window
  confetti({ y: 0.35 });
  playJingle();
  toast('Names drawn! Now send everyone their link.', { type: 'success' });
}

// ---------------------------------------------------------------------------
// Dialogs

function sendDialog(ctx, p) {
  const ev = ctx.ev;
  const entry = ev.draw.entries[p.id];
  const url = entryUrl(entry);
  const msg = textarea({ value: messageFor(ev, p, url), rows: 7, class: 'input textarea message-box', 'aria-label': 'Message' });
  const sentBox = h('input', { type: 'checkbox', id: 'sent-box', checked: !!entry.sentAt });
  const mark = () => {
    if (!sentBox.checked) {
      sentBox.checked = true;
      setSent(ctx, p.id, true);
    }
  };
  sentBox.addEventListener('change', () => setSent(ctx, p.id, sentBox.checked));
  const subject = `🎁 Your Secret Santa match for ${ev.name || 'our gift exchange'}`;

  const channel = (label, iconName, onClick, extra = {}) =>
    h('button', { type: 'button', class: 'channel', onClick, ...extra }, icon(iconName, { size: 22 }), h('span', label));
  const channelLink = (label, iconName, href) =>
    h('a', { class: 'channel', href, target: href.startsWith('http') ? '_blank' : undefined, rel: 'noopener noreferrer', onClick: mark }, icon(iconName, { size: 22 }), h('span', label));

  const mailLink = channelLink(p.email ? `Email ${p.email}` : 'Email', 'mail', mailtoHref(p.email, subject, msg.value));
  const smsLink = channelLink('Text message', 'message-circle', smsHref(p.phone, msg.value));
  const waLink = channelLink('WhatsApp', 'send', whatsappHref(p.phone, msg.value));
  // Edits to the message flow into every channel.
  msg.addEventListener('input', () => {
    mailLink.href = mailtoHref(p.email, subject, msg.value);
    smsLink.href = smsHref(p.phone, msg.value);
    waLink.href = whatsappHref(p.phone, msg.value);
  });

  openDialog({
    title: `Send ${p.name}’s link`,
    body: h(
      'div',
      { class: 'stack' },
      entry.sealed
        ? notice(`Sealed link: it only opens with ${p.name}’s secret phrase.`, 'info', 'lock')
        : notice(`The message doesn’t reveal the match. Only ${p.name} should open this link.`, 'info', 'eye-off'),
      msg,
      h(
        'div',
        { class: 'channels' },
        channel(
          'Copy message',
          'copy',
          async () => {
            toast((await copyText(msg.value)) ? 'Message copied' : 'Couldn’t copy', { type: 'success' });
            mark();
          },
          { autofocus: true },
        ),
        canNativeShare() &&
          channel('Share…', 'share-2', async () => {
            const r = await nativeShare({ title: subject, text: msg.value });
            if (r === 'shared') mark();
          }),
        mailLink,
        smsLink,
        waLink,
        channel('QR code', 'qr-code', () => {
          showQrDialog({ title: `${p.name}’s link`, url, caption: `Let ${p.name} scan this with their phone camera.`, filename: `${p.name}-secret-santa` });
          mark();
        }),
        channel('Copy link only', 'link', async () => {
          toast((await copyText(url)) ? 'Link copied' : 'Couldn’t copy', { type: 'success' });
          mark();
        }),
      ),
      h('label', { class: 'check', htmlFor: 'sent-box' }, sentBox, ` Mark as sent`),
    ),
    actions: [{ label: 'Done', variant: 'primary', value: true }],
  }).result.then(() => ctx.rerender());
}

function copyAllDialog(ctx) {
  const ev = ctx.ev;
  const text = ev.participants.map((p) => `${p.name}: ${entryUrl(ev.draw.entries[p.id])}`).join('\n\n');
  const ta = textarea({ value: text, rows: 10, readOnly: true, class: 'input textarea mono small', 'aria-label': 'All links' });
  openDialog({
    title: 'All links',
    body: h('div', { class: 'stack' }, notice('Send each person only their own link. Anyone who opens a regular link can see that person’s match.', 'warn'), ta),
    actions: [
      { label: 'Close', value: false },
      {
        label: 'Copy all',
        variant: 'primary',
        icon: 'copy',
        onClick: async () => {
          toast((await copyText(text)) ? 'All links copied' : 'Couldn’t copy', { type: 'success' });
          return false;
        },
      },
    ],
  });
}

function templateDialog(ctx) {
  const ev = ctx.ev;
  const ta = textarea({ value: ev.template || DEFAULT_TEMPLATE, rows: 8, maxlength: LIMITS.template, class: 'input textarea', 'aria-label': 'Message template' });
  const preview = h('pre', { class: 'preview-box' });
  const sample = ev.participants[0];
  const update = () => {
    preview.textContent = renderTemplate(ta.value, {
      name: sample ? sample.name : 'Ann',
      event: ev.name || 'our Secret Santa',
      link: 'https://…/#/r/…',
      date: formatDate(ev.date, ev.time),
      budget: ev.budget !== null ? formatMoney(ev.budget, ev.currency) : '',
      organizer: ev.organizer,
      sealed: ev.sealedMode ? SEALED_NOTE : '',
    });
  };
  ta.addEventListener('input', update);
  update();
  const insert = (ph) => {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.setRangeText(`{${ph}}`, start, end, 'end');
    ta.focus();
    update();
  };
  openDialog({
    title: 'Message template',
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted small' }, 'Used when you send links. Lines whose placeholders are empty (like a missing date) are left out automatically.'),
      h('div', { class: 'chips' }, PLACEHOLDERS.map((ph) => h('button', { type: 'button', class: 'chip', onClick: () => insert(ph) }, `{${ph}}`))),
      ta,
      h('p', { class: 'field-label' }, 'Preview'),
      preview,
    ),
    actions: [
      {
        label: 'Reset',
        value: false,
        onClick: () => {
          ta.value = DEFAULT_TEMPLATE;
          update();
          return false;
        },
      },
      {
        label: 'Save',
        variant: 'primary',
        onClick: () => {
          const v = cleanText(ta.value, LIMITS.template);
          ctx.change((e) => (e.template = v === DEFAULT_TEMPLATE ? '' : v));
          toast('Template saved', { type: 'success' });
          return true;
        },
      },
    ],
  });
}

async function revealAllDialog(ctx) {
  const ev = ctx.ev;
  const ok = await confirmDialog({
    title: 'Show every match?',
    message: 'This spoils the surprise for you. Make sure nobody else is looking at your screen.',
    confirmLabel: 'Show matches',
    danger: true,
  });
  if (!ok) return;
  const byId = new Map(ev.participants.map((p) => [p.id, p]));
  openDialog({
    title: 'All matches (spoilers!)',
    body: h(
      'table',
      { class: 'results-table' },
      h('thead', h('tr', h('th', { scope: 'col' }, 'Santa'), h('th', { scope: 'col' }, 'gives to'))),
      h(
        'tbody',
        ev.participants.map((p) => {
          const e = ev.draw.entries[p.id];
          const r = e && !e.sealed ? byId.get(e.recipientId) : null;
          return h('tr', h('td', `${p.emoji} ${p.name}`), h('td', e && e.sealed ? h('span', { class: 'muted' }, icon('lock', { size: 14 }), ' sealed') : r ? `${r.emoji} ${r.name}` : '?'));
        }),
      ),
    ),
    actions: [{ label: 'Hide', variant: 'primary', value: true }],
  });
}

async function exportResults(ctx) {
  const ev = ctx.ev;
  const ok = await confirmDialog({
    title: 'Download all matches?',
    message: 'The file lists who drew whom (sealed matches are not included because they’re unknown).',
    confirmLabel: 'Download CSV',
  });
  if (!ok) return;
  const byId = new Map(ev.participants.map((p) => [p.id, p]));
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Santa', 'Gives to'].map(q).join(',')];
  for (const p of ev.participants) {
    const e = ev.draw.entries[p.id];
    rows.push([p.name, e.sealed ? '(sealed)' : (byId.get(e.recipientId) || {}).name || '?'].map(q).join(','));
  }
  downloadFile(`${safeFilename(ev.name, 'secret-santa')}-matches.csv`, `﻿${rows.join('\r\n')}\r\n`, 'text/csv');
}

// ---------------------------------------------------------------------------

const REASON_TEXT = {
  participants: 'People were added or removed after the draw. Draw again so everyone is included.',
  keys: 'A secret-phrase key changed (or sealed mode was switched off) after the draw. Draw again.',
  rules: 'The current matches break your updated rules. Draw again.',
  details: 'You changed the exchange details after drawing, so the links still show the old ones.',
  people: 'Names, avatars or wishlists changed after drawing, so the links still show the old ones.',
  sealing: 'Some people signed up with secret phrases after the draw. Update the links to seal them.',
  'rules-unverifiable': 'You changed the rules after drawing. Sealed matches can’t be checked, so draw again to be sure.',
};

function statusBanner(ctx) {
  const ev = ctx.ev;
  const st = drawStatus(ev);
  if (st.state === 'ok' || st.state === 'none') return null;
  const refresh = async () => {
    try {
      const d = await refreshDraw(ctx.ev);
      ctx.change((e) => (e.draw = d), { rerender: true });
      ctx.flush();
      toast('Links updated with the same matches. Send everyone their new link.', { type: 'success' });
    } catch (e) {
      alertDialog({ title: 'Couldn’t update links', message: e.message });
    }
  };
  return notice(
    h(
      'div',
      { class: 'stack-sm' },
      h('strong', st.state === 'invalid' ? 'This draw needs redoing' : 'Links are out of date'),
      st.reasons.map((r) => h('p', REASON_TEXT[r] || r)),
      h(
        'div',
        { class: 'btn-row' },
        st.canRefresh && button('Update links (keep matches)', { variant: 'primary', size: 'sm', iconName: 'refresh-cw', onClick: refresh }),
        button('Draw again', { variant: st.canRefresh ? 'secondary' : 'primary', size: 'sm', iconName: 'shuffle', onClick: () => runDraw(ctx) }),
      ),
    ),
    st.state === 'invalid' ? 'error' : 'warn',
  );
}

function readiness(ctx) {
  const ev = ctx.ev;
  const ps = ev.participants;
  const items = [];
  const ok = (text) => items.push(h('li', { class: 'ready-ok' }, icon('circle-check', { size: 18 }), h('span', text)));
  const bad = (text) => items.push(h('li', { class: 'ready-bad' }, icon('circle-alert', { size: 18 }), h('span', text)));
  const info = (text) => items.push(h('li', { class: 'ready-info' }, icon('info', { size: 18 }), h('span', text)));
  let canDraw = true;
  if (ps.length < 2) {
    bad('Add at least 2 people.');
    canDraw = false;
  } else ok(`${plural(ps.length, 'person', 'people')} ready`);
  if (ps.length >= 2) {
    const a = analyze(ps, ev.rules);
    if (a.status === 'impossible') {
      bad(describeProblem(a.problem, ps.map((p) => p.name)));
      canDraw = false;
    } else ok('Your rules work');
  }
  if (ev.sealedMode) {
    const sealed = ps.filter((p) => p.key).length;
    if (sealed === ps.length && ps.length) ok('Everyone has a secret phrase, so all links will be sealed');
    else info(`${sealed} of ${ps.length} have signed up with a secret phrase. ${ps.length - sealed} will get a regular link.`);
  }
  if (!ev.name) info('No exchange name yet (optional, but nice).');
  if (!ev.date) info('No date set (optional).');
  if (ev.budget === null) info('No budget set (optional).');
  return { list: h('ul', { class: 'ready-list' }, items), canDraw };
}

export default function shareStep(ctx) {
  const ev = ctx.ev;
  if (!ev.draw) {
    const { list, canDraw } = readiness(ctx);
    return h(
      'div',
      { class: 'stack-lg' },
      card(
        h(
          'div',
          { class: 'stack draw-ready' },
          list,
          h(
            'div',
            { class: 'center stack-sm' },
            h(
              'button',
              { type: 'button', class: 'btn btn-primary btn-xl draw-btn', disabled: !canDraw, onClick: () => runDraw(ctx) },
              h('span', { 'aria-hidden': 'true' }, '🎲 '),
              'Draw names',
            ),
            h('p', { class: 'muted small' }, 'Each person gets a private link. You’ll send them on the next screen.'),
          ),
        ),
        { title: 'Ready?', titleIcon: 'party-popper' },
      ),
    );
  }

  const d = ev.draw;
  const fp = fingerprint(fromB64url(d.root));
  const total = ev.participants.length;
  const sentCount = ev.participants.filter((p) => d.entries[p.id] && d.entries[p.id].sentAt).length;
  const sealedCount = ev.participants.filter((p) => d.entries[p.id] && d.entries[p.id].sealed).length;

  const rows = ev.participants.map((p) => {
    const entry = d.entries[p.id];
    if (!entry) return null;
    const url = entryUrl(entry);
    const sentToggle = h('input', {
      type: 'checkbox',
      class: 'sent-check',
      checked: !!entry.sentAt,
      'aria-label': `Mark ${p.name}’s link as sent`,
      onChange: (e) => {
        setSent(ctx, p.id, e.target.checked);
        ctx.rerender();
      },
    });
    return h(
      'li',
      { class: cx(['share-row', entry.sentAt && 'is-sent']) },
      avatar(p.emoji),
      h(
        'div',
        { class: 'share-main' },
        h('span', { class: 'person-name' }, p.name, entry.sealed && h('span', { class: 'sealed-dot', title: 'Sealed link' }, icon('lock', { size: 14, label: 'sealed' }))),
        h('span', { class: 'person-sub' }, entry.sentAt ? `Sent ${timeAgo(entry.sentAt)}` : 'Not sent yet'),
      ),
      h(
        'div',
        { class: 'share-actions' },
        iconButton('copy', `Copy ${p.name}’s link`, async () => {
          const okCopy = await copyText(url);
          toast(okCopy ? `${p.name}’s link copied` : 'Couldn’t copy', { type: okCopy ? 'success' : 'error' });
          if (okCopy && !entry.sentAt) {
            setSent(ctx, p.id, true);
            ctx.rerender();
          }
        }),
        iconButton('qr-code', `QR code for ${p.name}`, () => showQrDialog({ title: `${p.name}’s link`, url, caption: `Let ${p.name} scan this with their phone camera.`, filename: `${p.name}-secret-santa` })),
        button('Send', { size: 'sm', variant: 'primary', iconName: 'send', onClick: () => sendDialog(ctx, p) }),
        h('label', { class: 'sent-label', title: 'Mark as sent' }, sentToggle, h('span', { class: 'hide-sm' }, 'Sent')),
      ),
    );
  });

  const more = h(
    'details',
    { class: 'menu menu-right' },
    h('summary', { class: 'btn btn-ghost btn-sm' }, icon('ellipsis', { size: 18 }), 'More'),
    h(
      'div',
      { class: 'menu-list' },
      h('button', { type: 'button', class: 'menu-item', onClick: () => revealAllDialog(ctx) }, icon('eye', { size: 16 }), 'Show all matches (spoilers)'),
      h('button', { type: 'button', class: 'menu-item', onClick: () => exportResults(ctx) }, icon('file-down', { size: 16 }), 'Download matches (CSV)'),
      h('button', { type: 'button', class: 'menu-item danger', onClick: () => runDraw(ctx) }, icon('shuffle', { size: 16 }), 'Draw again'),
    ),
  );

  return h(
    'div',
    { class: 'stack-lg' },
    statusBanner(ctx),
    h(
      'section',
      { class: 'card fingerprint-card' },
      h(
        'div',
        { class: 'fp-main' },
        h('p', { class: 'eyebrow' }, 'Draw fingerprint'),
        h('p', { class: 'fp-emoji', 'aria-label': `Fingerprint ${fp.emoji.join(' ')} ${fp.code}` }, fp.emoji.join(' ')),
        h('p', { class: 'fp-code mono' }, fp.code),
      ),
      h(
        'div',
        { class: 'fp-text' },
        h('p', 'Every link from this draw shows this fingerprint. Share it with the group so everyone can check theirs matches, proving all links come from the same draw.'),
        h(
          'p',
          { class: 'small muted' },
          `Drawn ${timeAgo(d.createdAt)} · ${d.method === 'uniform' ? 'perfectly uniform random draw' : 'randomized search (very tight rules)'}`,
          sealedCount ? ` · ${sealedCount} sealed` : '',
        ),
        button('Copy fingerprint', {
          size: 'sm',
          variant: 'ghost',
          iconName: 'copy',
          onClick: async () => toast((await copyText(`Our Secret Santa draw fingerprint: ${fp.emoji.join(' ')} ${fp.code}`)) ? 'Fingerprint copied' : 'Couldn’t copy', { type: 'success' }),
        }),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      linkButton('Party mode', `#/party/${ev.id}`, { iconName: 'smartphone', size: 'sm', onClick: () => ctx.flush() }),
      linkButton('Print cards', `#/print/${ev.id}`, { iconName: 'printer', size: 'sm', onClick: () => ctx.flush() }),
      button('Copy all links', { iconName: 'clipboard-list', size: 'sm', onClick: () => copyAllDialog(ctx) }),
      button('Edit message', { iconName: 'pencil', size: 'sm', onClick: () => templateDialog(ctx) }),
      more,
    ),
    card(
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'progress-wrap' },
          h('div', { class: 'progress-label' }, h('span', `${sentCount} of ${total} links sent`), sentCount === total && h('span', ' 🎉')),
          h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(sentCount), 'aria-label': 'Links sent' }, h('span', { class: 'progress-bar', style: { width: `${total ? (sentCount / total) * 100 : 0}%` } })),
        ),
        h('ul', { class: 'share-list' }, rows),
      ),
      { title: 'Send everyone their link', titleIcon: 'send' },
    ),
    h('p', { class: 'muted small' }, icon('eye-off', { size: 16 }), ' Matches are hidden here so you can stay surprised too. Use “More” to reveal them if you really need to.'),
  );
}
