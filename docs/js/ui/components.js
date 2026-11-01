// Small reusable UI pieces.
import { cx, h, uniqueId } from '../lib/dom.js';
import { icon } from './icons.js';

export function button(label, { variant = 'secondary', iconName = null, size = '', className = '', ...props } = {}) {
  return h(
    'button',
    { type: 'button', class: cx(['btn', `btn-${variant}`, size && `btn-${size}`, className]), ...props },
    iconName && icon(iconName, { size: size === 'sm' ? 16 : 18 }),
    label && h('span', label),
  );
}

export function linkButton(label, href, { variant = 'secondary', iconName = null, size = '', className = '', ...props } = {}) {
  return h(
    'a',
    { href, class: cx(['btn', `btn-${variant}`, size && `btn-${size}`, className]), ...props },
    iconName && icon(iconName, { size: size === 'sm' ? 16 : 18 }),
    label && h('span', label),
  );
}

export function iconButton(iconName, label, onClick, { className = '', ...props } = {}) {
  return h(
    'button',
    { type: 'button', class: cx(['icon-btn', className]), 'aria-label': label, title: label, onClick, ...props },
    icon(iconName, { size: 18 }),
  );
}

/** Labeled form field. `control` gets the generated id unless it already has one. */
export function field(label, control, { hint = '', optional = false, className = '' } = {}) {
  const id = control.id || uniqueId('f');
  control.id = id;
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${id}-hint` }, hint) : null;
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  const wrap = h(
    'div',
    { class: cx(['field', className]) },
    h('label', { class: 'field-label', htmlFor: id }, label, optional && h('span', { class: 'optional' }, 'optional')),
    control,
    hintEl,
    err,
  );
  wrap.setError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) control.setAttribute('aria-errormessage', err.id);
    else control.removeAttribute('aria-errormessage');
  };
  return wrap;
}

export function input(props = {}) {
  return h('input', { class: 'input', type: 'text', ...props });
}

export function textarea(props = {}) {
  return h('textarea', { class: 'input textarea', rows: 3, ...props });
}

export function select(options, value, props = {}) {
  return h(
    'select',
    { class: 'input select', ...props },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );
}

/** Accessible switch. */
export function toggle({ label, description = '', checked = false, onChange, disabled = false, iconName = null }) {
  const id = uniqueId('tg');
  const descId = description ? `${id}-d` : undefined;
  const box = h('input', {
    type: 'checkbox',
    role: 'switch',
    id,
    class: 'switch-input',
    checked,
    disabled,
    'aria-describedby': descId,
    onChange: (e) => onChange && onChange(e.target.checked),
  });
  return h(
    'div',
    { class: cx(['toggle', disabled && 'is-disabled']) },
    h(
      'label',
      { class: 'toggle-row', htmlFor: id },
      iconName && h('span', { class: 'toggle-icon' }, icon(iconName)),
      h('span', { class: 'toggle-text' }, h('span', { class: 'toggle-label' }, label), description && h('span', { class: 'toggle-desc', id: descId }, description)),
      box,
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
    ),
  );
}

export function badge(text, variant = 'neutral', iconName = null) {
  return h('span', { class: cx(['badge', `badge-${variant}`]) }, iconName && icon(iconName, { size: 14 }), text);
}

export function avatar(emoji, { size = 'md', label = '' } = {}) {
  return h('span', { class: cx(['avatar', `avatar-${size}`]), role: label ? 'img' : undefined, 'aria-label': label || undefined, 'aria-hidden': label ? undefined : 'true' }, emoji || '🎁');
}

export function notice(content, variant = 'info', iconName = null) {
  const ICON = { info: 'info', warn: 'triangle-alert', error: 'circle-alert', success: 'circle-check' };
  return h('div', { class: cx(['notice', `notice-${variant}`]), role: variant === 'error' ? 'alert' : undefined }, icon(iconName || ICON[variant] || 'info', { size: 18 }), h('div', { class: 'notice-body' }, content));
}

export function card(children, { className = '', title = '', titleIcon = null, actions = null } = {}) {
  return h(
    'section',
    { class: cx(['card', className]) },
    title && h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, titleIcon && icon(titleIcon), title), actions),
    children,
  );
}

export function emptyState({ emoji = '🎁', title, text = '', action = null }) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-emoji', 'aria-hidden': 'true' }, emoji), h('h3', title), text && h('p', { class: 'muted' }, text), action);
}

/** Radio-card group. options: [{value, label, emoji, description}] */
export function radioCards(name, options, value, onChange, { className = '', label = '' } = {}) {
  const group = h('div', { class: cx(['radio-cards', className]), role: 'radiogroup', 'aria-label': label || undefined });
  for (const o of options) {
    const id = uniqueId('rc');
    group.append(
      h(
        'label',
        { class: 'radio-card', htmlFor: id },
        h('input', { type: 'radio', name, id, value: o.value, checked: o.value === value, class: 'radio-input', onChange: () => onChange(o.value) }),
        o.swatch ? h('span', { class: `swatch swatch-${o.value}`, 'aria-hidden': 'true' }) : h('span', { class: 'radio-emoji', 'aria-hidden': 'true' }, o.emoji),
        h('span', { class: 'radio-label' }, o.label),
        o.description && h('span', { class: 'radio-desc' }, o.description),
      ),
    );
  }
  return group;
}

export function spinner(label = 'Working…') {
  return h('span', { class: 'spinner', role: 'status', 'aria-label': label });
}

/** A <details> disclosure. */
export function disclosure(summary, content, { open = false, className = '' } = {}) {
  return h('details', { class: cx(['disclosure', className]), open }, h('summary', h('span', summary), icon('chevron-down', { className: 'chev' })), h('div', { class: 'disclosure-body' }, content));
}
