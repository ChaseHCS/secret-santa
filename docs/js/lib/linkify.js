// Turns plain text into safe DOM: line breaks preserved, http(s) URLs become links.
// No HTML is ever parsed; hrefs are validated with the URL parser.
import { h } from './dom.js';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

export function safeUrl(raw) {
  let s = raw;
  if (/^www\./i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

function trimTrailing(url) {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?'"]/.test(last)) u = u.slice(0, -1);
    else if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
    else break;
  }
  return u;
}

function display(u) {
  const host = u.hostname.replace(/^www\./, '');
  let path = decodeURIComponentSafe(u.pathname + u.search).replace(/\/$/, '');
  if (path.length > 28) path = `${path.slice(0, 26)}…`;
  return host + path;
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function linkifyLine(line) {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    const raw = trimTrailing(m[0]);
    const u = safeUrl(raw);
    if (!u) continue;
    if (m.index > last) out.push(line.slice(last, m.index));
    out.push(
      h('a', { href: u.href, target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'ext-link' }, display(u)),
    );
    last = m.index + raw.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Multi-line text → paragraph with <br>s and links. */
export function richText(text, className = '') {
  const p = h('p', { class: className });
  text.split('\n').forEach((line, i) => {
    if (i) p.append(h('br'));
    p.append(...linkifyLine(line).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
  });
  return p;
}

/** One item per line → <ul>. */
export function wishlistList(text, className = 'wishlist') {
  const items = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return h(
    'ul',
    { class: className },
    items.map((item) => h('li', linkifyLine(item))),
  );
}
