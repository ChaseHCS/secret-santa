// Accessible modal dialogs built on the native <dialog> element (focus trap + Esc for free).
import { cx, h, uniqueId } from '../lib/dom.js';
import { icon } from './icons.js';

/**
 * openDialog({title, description, body, actions:[{label, value, variant, icon, onClick}], size, dismissible})
 * Action onClick may return false (or a Promise of false) to keep the dialog open.
 * @returns {{el, body, close(value), result: Promise<any>}}
 */
export function openDialog({
  title,
  description = '',
  body = null,
  actions = [],
  size = 'md',
  dismissible = true,
  className = '',
  onOpen = null,
} = {}) {
  const previous = document.activeElement;
  const titleId = uniqueId('dlg-title');
  const descId = description ? uniqueId('dlg-desc') : undefined;
  let value;
  let resolve;
  const result = new Promise((r) => {
    resolve = r;
  });

  const bodyEl = h('div', { class: 'dialog-body' }, body);
  const footer = actions.length ? h('div', { class: 'dialog-actions' }) : null;
  const dlg = h(
    'dialog',
    { class: cx(['dialog', `dialog-${size}`, className]), 'aria-labelledby': titleId, 'aria-describedby': descId },
    h(
      'div',
      { class: 'dialog-inner' },
      h(
        'div',
        { class: 'dialog-head' },
        h('h2', { id: titleId, class: 'dialog-title' }, title),
        dismissible &&
          h(
            'button',
            { type: 'button', class: 'icon-btn dialog-x', 'aria-label': 'Close', onClick: () => close(undefined) },
            icon('x'),
          ),
      ),
      description && h('p', { id: descId, class: 'dialog-desc' }, description),
      bodyEl,
      footer,
    ),
  );

  function close(v) {
    value = v;
    if (dlg.open) dlg.close();
  }

  for (const a of actions) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: cx(['btn', `btn-${a.variant || 'secondary'}`]),
        autofocus: a.autofocus || undefined,
        onClick: async () => {
          if (a.onClick) {
            btn.disabled = true;
            try {
              const r = await a.onClick(api);
              if (r === false) return;
            } finally {
              btn.disabled = false;
            }
          }
          close(a.value);
        },
      },
      a.icon && icon(a.icon, { size: 18 }),
      a.label,
    );
    footer.append(btn);
  }

  dlg.addEventListener('cancel', (e) => {
    if (!dismissible) e.preventDefault();
    else value = undefined;
  });
  // Close on backdrop click, but only if the press started on the backdrop too
  // (so drag-selecting text inside an input doesn't close the dialog).
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dlg;
  });
  dlg.addEventListener('click', (e) => {
    if (dismissible && downOnBackdrop && e.target === dlg) close(undefined);
    downOnBackdrop = false;
  });
  dlg.addEventListener('close', () => {
    resolve(value);
    setTimeout(() => dlg.remove(), 0);
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
  });

  const api = { el: dlg, body: bodyEl, close, result };
  document.body.append(dlg);
  dlg.showModal();
  const auto = dlg.querySelector('[autofocus]') || dlg.querySelector('input, textarea, select');
  if (auto) auto.focus();
  if (onOpen) onOpen(api);
  return api;
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, body = null }) {
  return openDialog({
    title,
    description: message,
    body,
    size: 'sm',
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary', autofocus: !danger },
    ],
  }).result.then((v) => v === true);
}

export function alertDialog({ title, message, body = null, okLabel = 'OK' }) {
  return openDialog({ title, description: message, body, size: 'sm', actions: [{ label: okLabel, value: true, variant: 'primary', autofocus: true }] }).result;
}
