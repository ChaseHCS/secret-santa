// Minimal DOM builder. Text is always inserted as text nodes, never parsed as HTML,
// so untrusted strings (names, wishlists from links) can't inject markup.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'readOnly', 'required', 'indeterminate', 'open', 'defaultValue']);

export function cx(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(cx).filter(Boolean).join(' ');
  return Object.keys(v)
    .filter((k) => v[k])
    .join(' ');
}

function setProps(el, props, svg) {
  for (const key of Object.keys(props)) {
    const val = props[key];
    if (val === undefined || val === null) continue;
    if (key === 'class' || key === 'className') {
      const c = cx(val);
      if (c) el.setAttribute('class', c);
    } else if (key === 'style') {
      for (const [p, v] of Object.entries(val)) {
        if (v === null || v === undefined) continue;
        if (p.startsWith('--')) el.style.setProperty(p, String(v));
        else el.style[p] = v;
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(val)) if (v !== null && v !== undefined) el.dataset[k] = String(v);
    } else if (key === 'ref') {
      val(el);
    } else if (key === 'text') {
      el.textContent = String(val);
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'innerHTML' || key === 'outerHTML') {
      throw new Error('Refusing to set HTML');
    } else if (!svg && PROPS.has(key)) {
      el[key] = val;
    } else if (key.startsWith('aria-') && typeof val === 'boolean') {
      el.setAttribute(key, String(val));
    } else if (val === false) {
      continue;
    } else {
      el.setAttribute(key === 'htmlFor' ? 'for' : key, val === true ? '' : String(val));
    }
  }
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** h('div', {class: 'x', onClick}, 'text', child, [more]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
  } else if (props) {
    setProps(el, props, false);
  }
  append(el, children);
  return el;
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) setProps(el, props, true);
  append(el, children);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Append children, skipping null/false (Node#append would stringify them). */
export function add(el, ...children) {
  append(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

let uid = 0;
export function uniqueId(prefix = 'id') {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function prefersReducedMotion() {
  return document.documentElement.dataset.motion === 'reduce';
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
