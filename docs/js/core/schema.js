// Shared limits, enums and sanitizers. Everything decoded from a link is untrusted:
// it is validated here and only ever rendered with textContent.

export const LIMITS = Object.freeze({
  eventName: 80,
  name: 40,
  email: 120,
  phone: 32,
  group: 40,
  location: 120,
  message: 400,
  organizer: 60,
  wishlist: 1000,
  notes: 300,
  emoji: 16,
  template: 1200,
  participants: 300,
});

export const THEMES = Object.freeze(['classic', 'frost', 'candy', 'evergreen', 'midnight']);
export const REVEAL_STYLES = Object.freeze(['giftbox', 'scratch', 'envelope']);

// C0/C1 controls, zero-width space, line/paragraph separators, bidi embeddings/overrides/isolates
// and BOM. Zero-width joiners are kept because emoji sequences need them.
// eslint-disable-next-line no-control-regex
const CONTROL_SINGLE = /[\u0000-\u001f\u007f-\u009f\u200b\u2028-\u202e\u2066-\u2069\ufeff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTI = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b\u2028-\u202e\u2066-\u2069\ufeff]/g;

function truncate(s, max) {
  if (s.length <= max) return s;
  // Truncate by code points so we never leave half a surrogate pair behind.
  return Array.from(s).slice(0, max).join('').trimEnd();
}

/** Single-line text: strips control/bidi characters, collapses whitespace, trims, caps length. */
export function cleanLine(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(CONTROL_SINGLE, ' ').replace(/\s+/g, ' ').trim();
  return truncate(s, max);
}

/** Multi-line text: keeps newlines (max 2 blank lines in a row), strips other control characters. */
export function cleanText(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r\n?/g, '\n').replace(CONTROL_MULTI, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(s, max);
}

export function cleanEmoji(v) {
  const s = cleanLine(v, LIMITS.emoji);
  // Keep only short strings without ASCII letters/digits (i.e. emoji-ish).
  if (!s || /[A-Za-z0-9<>&"']/.test(s)) return '';
  return s;
}

export function cleanDate(v) {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  if (y < 2000 || y > 2200) return '';
  return s;
}

export function cleanTime(v) {
  const s = String(v ?? '');
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return '';
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return s;
}

export function cleanBudget(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return null;
  return Math.round(n * 100) / 100;
}

export function cleanCurrency(v) {
  const s = String(v ?? '').toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : 'USD';
}

export function cleanEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

export function cleanId(v) {
  const s = String(v ?? '');
  return /^[a-z0-9]{6,32}$/.test(s) ? s : '';
}

export function cleanEmail(v) {
  const s = cleanLine(v, LIMITS.email);
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/.test(s) ? s : '';
}

export function cleanPhone(v) {
  const s = cleanLine(v, LIMITS.phone);
  return /^\+?[0-9 ().-]{3,}$/.test(s) && /\d{3,}/.test(s.replace(/\D/g, '')) ? s : '';
}

/** Event details as embedded in links (compact keys). */
export function cleanEventDetails(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanId(o.id),
    n: cleanLine(o.n, LIMITS.eventName) || 'Secret Santa',
    d: cleanDate(o.d),
    t: cleanTime(o.t),
    b: cleanBudget(o.b),
    c: cleanCurrency(o.c),
    l: cleanLine(o.l, LIMITS.location),
    m: cleanText(o.m, LIMITS.message),
    o: cleanLine(o.o, LIMITS.organizer),
    th: cleanEnum(o.th, THEMES, 'classic'),
    rs: cleanEnum(o.rs, REVEAL_STYLES, 'giftbox'),
  };
}
