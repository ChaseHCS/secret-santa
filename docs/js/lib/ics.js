// iCalendar (.ics) generation (RFC 5545). Times are "floating" (local wall clock).
import { utf8 } from './bytes.js';

function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets without splitting UTF-8 sequences. */
export function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = utf8(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.map((l, i) => (i ? ` ${l}` : l)).join('\r\n');
}

const pad = (n) => String(n).padStart(2, '0');

function stamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function dateOnly(date) {
  return date.replace(/-/g, '');
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/** {uid, title, date:'YYYY-MM-DD', time:'HH:MM'|'' , durationMinutes, description, location, alarmDays} */
export function buildIcs({ uid, title, date, time = '', durationMinutes = 120, description = '', location = '', alarmDays = 2 }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Secret Santa//Gift Exchange//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'];
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${stamp(new Date())}`);
  if (time) {
    const [hh, mm] = time.split(':').map(Number);
    const start = `${dateOnly(date)}T${pad(hh)}${pad(mm)}00`;
    const endMinutes = hh * 60 + mm + durationMinutes;
    const endDay = Math.floor(endMinutes / 1440);
    const rem = endMinutes % 1440;
    const end = `${endDay ? addDays(date, endDay) : dateOnly(date)}T${pad(Math.floor(rem / 60))}${pad(rem % 60)}00`;
    lines.push(`DTSTART:${start}`, `DTEND:${end}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(date)}`, `DTEND;VALUE=DATE:${addDays(date, 1)}`);
  }
  lines.push(`SUMMARY:${esc(title)}`);
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (alarmDays) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`Reminder: ${title}`)}`, `TRIGGER:-P${alarmDays}D`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function googleCalendarUrl({ title, date, time = '', durationMinutes = 120, description = '', location = '' }) {
  let dates;
  if (time) {
    const [hh, mm] = time.split(':').map(Number);
    const start = `${dateOnly(date)}T${pad(hh)}${pad(mm)}00`;
    const endMinutes = hh * 60 + mm + durationMinutes;
    const endDay = Math.floor(endMinutes / 1440);
    const rem = endMinutes % 1440;
    const end = `${endDay ? addDays(date, endDay) : dateOnly(date)}T${pad(Math.floor(rem / 60))}${pad(rem % 60)}00`;
    dates = `${start}/${end}`;
  } else {
    dates = `${dateOnly(date)}/${addDays(date, 1)}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details: description, location });
  return `https://calendar.google.com/calendar/render?${params}`;
}
