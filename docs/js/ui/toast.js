import { h } from '../lib/dom.js';
import { icon } from './icons.js';

let region = null;

function ensureRegion() {
  if (region && region.isConnected) return region;
  region = h('div', { class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
  document.body.append(region);
  return region;
}

const ICON = { info: 'info', success: 'circle-check', error: 'circle-alert', warn: 'triangle-alert' };

/** toast('Copied!', {type:'success', action:{label:'Undo', onClick}}) → dismiss() */
export function toast(message, { type = 'info', action = null, duration = 3200 } = {}) {
  const host = ensureRegion();
  let timer = null;
  const el = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : undefined },
    icon(ICON[type] || 'info', { size: 18 }),
    h('span', { class: 'toast-msg' }, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onClick: () => {
            dismiss();
            action.onClick();
          },
        },
        action.label,
      ),
  );
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
  // Keep at most 4 toasts on screen.
  while (host.children.length > 4) host.firstElementChild.remove();
  return dismiss;
}

/** Remove all toasts (e.g. before showing a participant's private page). */
export function clearToasts() {
  if (region) region.replaceChildren();
}
