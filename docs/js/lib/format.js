// Formatting helpers (dates are wall-clock local: "Dec 24 at 7pm" means 7pm wherever you are).

export function eventDate(date, time) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  let hh = 0;
  let mm = 0;
  if (time) [hh, mm] = time.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function formatDate(date, time, { weekday = true } = {}) {
  const dt = eventDate(date, time);
  if (!dt) return '';
  const day = dt.toLocaleDateString(undefined, {
    weekday: weekday ? 'long' : undefined,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (!time) return day;
  const t = dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t}`;
}

export function formatShortDate(date, time) {
  const dt = eventDate(date, time);
  if (!dt) return '';
  const thisYear = new Date().getFullYear() === dt.getFullYear();
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: thisYear ? undefined : 'numeric',
  });
}

export function formatMoney(amount, currency = 'USD') {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

/** Whole calendar days from today (local) to the event date; negative if past. */
export function daysUntil(date, from = new Date()) {
  const dt = eventDate(date);
  if (!dt) return null;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate());
  return Math.round((b - a) / 86400000);
}

export function relativeDays(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

export function countdownParts(target, now = Date.now()) {
  const diff = target.getTime() - now;
  const past = diff < 0;
  let s = Math.floor(Math.abs(diff) / 1000);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s - minutes * 60;
  return { past, days, hours, minutes, seconds };
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Big counts → "1,234" or "≈ 2.4 × 10¹⁴". */
export function formatBigCount(count, log2) {
  if (count !== null && count !== undefined && count < 1e9) return Math.round(count).toLocaleString();
  const l2 = log2 ?? Math.log2(count);
  if (l2 === null || !Number.isFinite(l2)) return '?';
  const log10 = l2 * Math.LOG10E * Math.LN2;
  const exp = Math.floor(log10);
  const mant = 10 ** (log10 - exp);
  return `${mant.toFixed(1)} × 10${superscript(exp)}`;
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
function superscript(n) {
  return String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('');
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Days until the next Christmas Day (0 on the day itself). */
export function daysUntilChristmas(now = new Date()) {
  let year = now.getFullYear();
  const today = Date.UTC(year, now.getMonth(), now.getDate());
  let xmas = Date.UTC(year, 11, 25);
  if (today > xmas) xmas = Date.UTC(++year, 11, 25);
  return Math.round((xmas - today) / 86400000);
}
