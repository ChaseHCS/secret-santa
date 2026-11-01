// Exchange ("event") model: creation, validation, persistence, drawing and link generation.

import { fromB64url, hashString, toB64url } from '../lib/bytes.js';
import { randomBytes, randomId } from '../lib/random.js';
import * as storage from '../lib/storage.js';
import { AVATARS, nextAvatar } from '../lib/emoji.js';
import { buildConstraints, drawAssignments, normName, validateAssignments } from './draw.js';
import { buildTree, getProof, leafHash, rootOf } from './merkle.js';
import {
  buildRevealObject,
  encodeReveal,
  encodeRevealBytes,
  encodeSealed,
  headerAad,
  sealedHeaderBytes,
} from './payload.js';
import {
  LIMITS,
  REVEAL_STYLES,
  THEMES,
  cleanBudget,
  cleanCurrency,
  cleanDate,
  cleanEmail,
  cleanEmoji,
  cleanEnum,
  cleanEventDetails,
  cleanId,
  cleanLine,
  cleanPhone,
  cleanText,
  cleanTime,
} from './schema.js';
import { parseWrap, seal, validatePublicKey } from './seal.js';

const EVENT_KEY = 'event:';
export const FORMAT = 'secret-santa-exchange';

// ---------------------------------------------------------------------------
// Construction & validation

export function createParticipant(fields = {}, existing = []) {
  return normalizeParticipant(
    {
      id: randomId(),
      source: 'manual',
      addedAt: Date.now(),
      ...fields,
      // Spread first so an explicit `emoji: undefined` can't wipe the default.
      emoji: cleanEmoji(fields.emoji) || nextAvatar(existing.map((p) => p.emoji)),
    },
    true,
  );
}

function normalizeKey(key) {
  if (!key || typeof key !== 'object') return null;
  try {
    const pub = fromB64url(String(key.pub));
    const wrap = fromB64url(String(key.wrap));
    if (!validatePublicKey(pub)) return null;
    parseWrap(wrap);
    return { pub: String(key.pub), wrap: String(key.wrap) };
  } catch {
    return null;
  }
}

function normalizeParticipant(raw, fresh = false) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    id: cleanId(o.id) || randomId(),
    name: cleanLine(o.name, LIMITS.name),
    emoji: cleanEmoji(o.emoji) || (fresh ? AVATARS[0] : '🎁'),
    email: cleanEmail(o.email),
    phone: cleanPhone(o.phone),
    group: cleanLine(o.group, LIMITS.group),
    wishlist: cleanText(o.wishlist, LIMITS.wishlist),
    notes: cleanText(o.notes, LIMITS.notes),
    key: normalizeKey(o.key),
    source: o.source === 'signup' ? 'signup' : 'manual',
    addedAt: Number.isFinite(o.addedAt) ? o.addedAt : Date.now(),
  };
}

export function createEvent(fields = {}) {
  const now = Date.now();
  return normalizeEvent({
    id: randomId(),
    createdAt: now,
    updatedAt: now,
    rules: { groupsExclusive: true },
    ...fields,
  });
}

function normalizeRules(raw, ids) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const exclusions = [];
  for (const ex of Array.isArray(o.exclusions) ? o.exclusions : []) {
    if (!ex || !ids.has(ex.from) || !ids.has(ex.to) || ex.from === ex.to) continue;
    const k = `${ex.from}>${ex.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    exclusions.push({ from: ex.from, to: ex.to });
  }
  const avoid = [];
  const seenAvoid = new Set();
  for (const a of Array.isArray(o.avoid) ? o.avoid.slice(0, 2000) : []) {
    const from = cleanLine(a && a.from, LIMITS.name);
    const to = cleanLine(a && a.to, LIMITS.name);
    if (!from || !to) continue;
    const k = `${normName(from)}>${normName(to)}`;
    if (seenAvoid.has(k)) continue;
    seenAvoid.add(k);
    avoid.push({ from, to });
  }
  return {
    groupsExclusive: o.groupsExclusive !== false,
    noReciprocal: !!o.noReciprocal,
    singleCycle: !!o.singleCycle,
    exclusions,
    avoid,
    avoidLabel: cleanLine(o.avoidLabel, 80),
  };
}

function normalizeDraw(raw, ids) {
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return null;
  const entries = {};
  for (const [id, e] of Object.entries(raw.entries)) {
    if (!cleanId(id) || !e || typeof e.link !== 'string' || !/^[A-Za-z0-9_-]+$/.test(e.link)) return null;
    entries[id] = {
      sealed: !!e.sealed,
      link: e.link,
      index: Number.isInteger(e.index) ? e.index : -1,
      sentAt: Number.isFinite(e.sentAt) ? e.sentAt : 0,
    };
    if (!e.sealed) {
      if (!ids.has(e.recipientId) && !cleanId(e.recipientId)) return null;
      entries[id].recipientId = e.recipientId;
      entries[id].salt = typeof e.salt === 'string' ? e.salt : '';
    }
  }
  return {
    id: cleanId(raw.id) || randomId(),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    method: raw.method === 'search' ? 'search' : 'uniform',
    root: typeof raw.root === 'string' ? raw.root : '',
    leaves: Array.isArray(raw.leaves) ? raw.leaves.filter((x) => typeof x === 'string') : [],
    count: Number.isInteger(raw.count) ? raw.count : Object.keys(entries).length,
    entries,
    snap: raw.snap && typeof raw.snap === 'object' ? raw.snap : {},
  };
}

export function normalizeEvent(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const participants = [];
  const names = new Set();
  const ids = new Set();
  for (const p of Array.isArray(o.participants) ? o.participants : []) {
    if (participants.length >= LIMITS.participants) break;
    const np = normalizeParticipant(p);
    if (!np.name) continue;
    while (ids.has(np.id)) np.id = randomId();
    let base = np.name;
    let k = 2;
    while (names.has(normName(np.name))) np.name = cleanLine(`${base} (${k++})`, LIMITS.name);
    names.add(normName(np.name));
    ids.add(np.id);
    participants.push(np);
  }
  const viewed = {};
  if (o.party && o.party.viewed && typeof o.party.viewed === 'object') {
    for (const [id, ts] of Object.entries(o.party.viewed)) if (ids.has(id) && Number.isFinite(ts)) viewed[id] = ts;
  }
  return {
    v: 1,
    id: cleanId(o.id) || randomId(),
    createdAt: Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
    updatedAt: Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    name: cleanLine(o.name, LIMITS.eventName),
    date: cleanDate(o.date),
    time: cleanTime(o.time),
    budget: cleanBudget(o.budget),
    currency: cleanCurrency(o.currency || defaultCurrency()),
    location: cleanLine(o.location, LIMITS.location),
    message: cleanText(o.message, LIMITS.message),
    organizer: cleanLine(o.organizer, LIMITS.organizer),
    theme: cleanEnum(o.theme, THEMES, 'classic'),
    revealStyle: cleanEnum(o.revealStyle, REVEAL_STYLES, 'giftbox'),
    sealedMode: !!o.sealedMode,
    template: cleanText(o.template, LIMITS.template),
    participants,
    rules: normalizeRules(o.rules, ids),
    draw: normalizeDraw(o.draw, ids),
    party: { viewed },
  };
}

const REGION_CURRENCY = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR',
  IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', JP: 'JPY', IN: 'INR',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', SG: 'SGD',
  HK: 'HKD', CN: 'CNY', KR: 'KRW', PH: 'PHP', AE: 'AED', IL: 'ILS', CZ: 'CZK', HU: 'HUF', TR: 'TRY',
};

export function defaultCurrency() {
  try {
    const loc = new Intl.Locale(navigator.language || 'en-US').maximize();
    return REGION_CURRENCY[loc.region] || 'USD';
  } catch {
    return 'USD';
  }
}

// ---------------------------------------------------------------------------
// Persistence

export function listEvents() {
  return storage
    .keys(EVENT_KEY)
    .map((k) => storage.getJSON(k))
    .filter((e) => e && typeof e === 'object' && e.id)
    .map(normalizeEvent)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadEvent(id) {
  const raw = storage.getJSON(EVENT_KEY + id);
  return raw ? normalizeEvent(raw) : null;
}

/** @returns {boolean} whether it was saved */
export function saveEvent(ev) {
  ev.updatedAt = Date.now();
  return storage.setJSON(EVENT_KEY + ev.id, ev);
}

export function deleteEvent(id) {
  storage.remove(EVENT_KEY + id);
}

export function eventStorageKey(id) {
  return storage.STORAGE_PREFIX + EVENT_KEY + id;
}

// ---------------------------------------------------------------------------
// What goes into links

export function eventDetails(ev) {
  return cleanEventDetails({
    id: ev.id,
    n: ev.name,
    d: ev.date,
    t: ev.time,
    b: ev.budget,
    c: ev.currency,
    l: ev.location,
    m: ev.message,
    o: ev.organizer,
    th: ev.theme,
    rs: ev.revealStyle,
  });
}

function embed(p) {
  return { name: p.name, emoji: p.emoji, wishlist: p.wishlist, notes: p.notes };
}

function constraintSig(ev) {
  const C = buildConstraints(ev.participants, ev.rules);
  const rows = C.allowed.map((row) => row.map((x) => (x ? 1 : 0)).join('')).join('|');
  return hashString(`${rows}#${C.noReciprocal ? 1 : 0}${C.singleCycle ? 1 : 0}`);
}

function snapshot(ev) {
  const people = {};
  const keys = {};
  for (const p of ev.participants) {
    people[p.id] = hashString(JSON.stringify([p.name, p.emoji, p.wishlist, p.notes]));
    keys[p.id] = p.key ? hashString(p.key.pub + p.key.wrap) : '';
  }
  return {
    ids: ev.participants.map((p) => p.id).join(','),
    details: hashString(JSON.stringify(eventDetails(ev))),
    people,
    keys,
    constraints: constraintSig(ev),
    sealedMode: !!ev.sealedMode,
  };
}

/** Build all links for a given {giverId: recipientId} mapping. */
async function buildDraw(ev, assignments, { method, salts = null, id = null, createdAt = null } = {}) {
  const ps = ev.participants;
  const byId = new Map(ps.map((p) => [p.id, p]));
  const n = ps.length;
  const details = eventDetails(ev);
  const saltBytes = ps.map((p) => (salts && salts[p.id] ? fromB64url(salts[p.id]) : randomBytes(16)));
  const leaves = await Promise.all(
    ps.map((p, i) => leafHash(i, p.name, byId.get(assignments[p.id]).name, saltBytes[i])),
  );
  const levels = await buildTree(leaves);
  const root = rootOf(levels);

  const entries = {};
  for (let i = 0; i < n; i++) {
    const giver = ps[i];
    const recipient = byId.get(assignments[giver.id]);
    const obj = buildRevealObject({
      event: details,
      giver: embed(giver),
      recipient: embed(recipient),
      verification: { root, index: i, count: n, salt: saltBytes[i], proof: getProof(levels, i) },
    });
    if (ev.sealedMode && giver.key) {
      const header = { e: ev.id, en: details.n, g: giver.name, ga: giver.emoji, th: details.th, k: giver.key.pub };
      const headerBytes = sealedHeaderBytes(header);
      const box = await seal(fromB64url(giver.key.pub), await encodeRevealBytes(obj), headerAad(headerBytes));
      // Deliberately NOT stored: recipient and salt (the salt + stored leaf would let
      // the organizer brute-force the recipient).
      entries[giver.id] = {
        sealed: true,
        link: encodeSealed(headerBytes, fromB64url(giver.key.wrap), box),
        index: i,
        sentAt: 0,
      };
    } else {
      entries[giver.id] = {
        sealed: false,
        link: await encodeReveal(obj),
        recipientId: recipient.id,
        salt: toB64url(saltBytes[i]),
        index: i,
        sentAt: 0,
      };
    }
  }
  return {
    id: id || randomId(),
    createdAt: createdAt || Date.now(),
    method,
    root: toB64url(root),
    leaves: leaves.map(toB64url),
    count: n,
    entries,
    snap: snapshot(ev),
  };
}

/** Draw names and build every link. Does not save. */
export async function makeDraw(ev, opts = {}) {
  const res = drawAssignments(ev.participants, ev.rules, opts);
  if (!res.ok) return res;
  const draw = await buildDraw(ev, res.assignments, { method: res.method });
  return { ok: true, draw };
}

/** Rebuild links with the same matches (only possible when no entry is sealed). */
export async function refreshDraw(ev) {
  const d = ev.draw;
  if (!d) throw new Error('Nothing to refresh');
  const assignments = {};
  const salts = {};
  for (const p of ev.participants) {
    const e = d.entries[p.id];
    if (!e || e.sealed) throw new Error('This draw cannot be refreshed; draw again instead.');
    assignments[p.id] = e.recipientId;
    salts[p.id] = e.salt;
  }
  if (!validateAssignments(ev.participants, ev.rules, assignments)) {
    throw new Error('The current matches no longer satisfy your rules. Draw again instead.');
  }
  return buildDraw(ev, assignments, { method: d.method, salts, id: d.id, createdAt: d.createdAt });
}

/**
 * Compare the saved draw with the current event.
 * @returns {{state:'none'|'ok'|'outdated'|'invalid', reasons:string[], canRefresh:boolean}}
 */
export function drawStatus(ev) {
  const d = ev.draw;
  if (!d) return { state: 'none', reasons: [], canRefresh: false };
  const snap = d.snap || {};
  const ids = ev.participants.map((p) => p.id);
  const entries = d.entries;
  const sealedIds = ids.filter((id) => entries[id] && entries[id].sealed);
  const anySealed = sealedIds.length > 0;

  if (ids.join(',') !== snap.ids || ids.some((id) => !entries[id]) || Object.keys(entries).length !== ids.length) {
    return { state: 'invalid', reasons: ['participants'], canRefresh: false };
  }
  const now = snapshot(ev);
  for (const id of sealedIds) {
    const p = ev.participants.find((x) => x.id === id);
    if (!ev.sealedMode || !p.key || now.keys[id] !== (snap.keys || {})[id]) {
      return { state: 'invalid', reasons: ['keys'], canRefresh: false };
    }
  }
  const reasons = [];
  if (now.constraints !== snap.constraints) {
    if (anySealed) {
      reasons.push('rules-unverifiable');
    } else {
      const map = {};
      for (const id of ids) map[id] = entries[id].recipientId;
      if (!validateAssignments(ev.participants, ev.rules, map)) {
        return { state: 'invalid', reasons: ['rules'], canRefresh: false };
      }
    }
  }
  if (now.details !== snap.details) reasons.push('details');
  if (ids.some((id) => now.people[id] !== (snap.people || {})[id])) reasons.push('people');
  if (ev.sealedMode && ev.participants.some((p) => p.key && !entries[p.id].sealed)) reasons.push('sealing');
  if (!reasons.length) return { state: 'ok', reasons, canRefresh: false };
  return { state: 'outdated', reasons, canRefresh: !anySealed && !reasons.includes('rules-unverifiable') };
}

/** Known (non-sealed) pairs as names, e.g. to avoid repeats next year. */
export function knownPairs(ev) {
  if (!ev.draw) return [];
  const byId = new Map(ev.participants.map((p) => [p.id, p]));
  const out = [];
  for (const [gid, e] of Object.entries(ev.draw.entries)) {
    if (e.sealed) continue;
    const g = byId.get(gid);
    const r = byId.get(e.recipientId);
    if (g && r) out.push({ from: g.name, to: r.name });
  }
  return out;
}

function bumpYear(s) {
  return s.replace(/\b(20\d\d)\b/, (m) => String(Number(m) + 1));
}

export function duplicateForNextYear(ev) {
  const idMap = new Map();
  const participants = ev.participants.map((p) => {
    const id = randomId();
    idMap.set(p.id, id);
    return { ...p, id, key: null, source: 'manual' };
  });
  const pairs = knownPairs(ev);
  const nextName = bumpYear(ev.name);
  const date = ev.date ? `${Number(ev.date.slice(0, 4)) + 1}${ev.date.slice(4)}` : '';
  return createEvent({
    name: nextName === ev.name ? `${ev.name} (next)` : nextName,
    date: cleanDate(date),
    time: ev.time,
    budget: ev.budget,
    currency: ev.currency,
    location: ev.location,
    message: ev.message,
    organizer: ev.organizer,
    theme: ev.theme,
    revealStyle: ev.revealStyle,
    sealedMode: ev.sealedMode,
    template: ev.template,
    participants,
    rules: {
      ...ev.rules,
      exclusions: ev.rules.exclusions.map((x) => ({ from: idMap.get(x.from), to: idMap.get(x.to) })),
      avoid: pairs.length ? pairs : ev.rules.avoid,
      avoidLabel: pairs.length ? `${ev.name || 'Last exchange'}` : ev.rules.avoidLabel,
    },
  });
}

// ---------------------------------------------------------------------------
// Sign-ups (join codes)

/**
 * What would importing this join code do?
 * keyChange: an existing person's sealed-mode key would be replaced. Only accept that if
 * the code really came from them, otherwise someone else could read their match.
 */
export function previewJoin(ev, j) {
  if (j.e !== ev.id) return { status: 'wrong-event' };
  const existing = ev.participants.find((p) => normName(p.name) === normName(j.n)) || null;
  if (!existing) {
    if (ev.participants.length >= LIMITS.participants) return { status: 'full' };
    return { status: 'new', existing: null, keyChange: false };
  }
  const keyChange = !!(j.k && existing.key && (existing.key.pub !== j.k || existing.key.wrap !== j.wr));
  const same =
    existing.wishlist === j.w && existing.notes === j.no && (!j.k || (existing.key && existing.key.pub === j.k)) && (!j.a || existing.emoji === j.a);
  return { status: same ? 'same' : 'update', existing, keyChange };
}

export function applyJoin(ev, j) {
  const pv = previewJoin(ev, j);
  if (pv.status === 'wrong-event' || pv.status === 'full') return pv.status;
  if (pv.status === 'same') return 'same';
  const key = j.k ? { pub: j.k, wrap: j.wr } : null;
  if (pv.existing) {
    const p = pv.existing;
    p.wishlist = j.w;
    p.notes = j.no;
    if (j.a) p.emoji = j.a;
    if (j.em) p.email = j.em;
    if (key) p.key = normalizeKey(key);
    p.source = 'signup';
    return 'updated';
  }
  const p = createParticipant({ name: j.n, emoji: j.a || undefined, wishlist: j.w, notes: j.no, email: j.em, key, source: 'signup' }, ev.participants);
  ev.participants.push(p);
  return 'added';
}

// ---------------------------------------------------------------------------
// Backup files

export function exportEvent(ev) {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), event: ev }, null, 2);
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a valid backup (not JSON).');
  }
  const list = [];
  if (data && data.format === FORMAT && data.event) list.push(data.event);
  else if (data && data.format === FORMAT && Array.isArray(data.events)) list.push(...data.events);
  else throw new Error('That file isn’t a Secret Santa backup.');
  return list.map(normalizeEvent);
}

export function exportAll(events) {
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), events }, null, 2);
}

// ---------------------------------------------------------------------------
// Demo data

export function demoEvent() {
  const year = new Date().getMonth() === 11 && new Date().getDate() > 20 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const people = [
    ['Rudolph', '🦌', 'Reindeer', 'Red nose polish\nLED headlamp\nA map of the Arctic', 'Allergic to tinsel'],
    ['Dasher', '🦌', 'Reindeer', 'Running shoes (hoof size 4)\nEnergy bars', ''],
    ['Blitzen', '⚡', 'Reindeer', 'Noise-cancelling earmuffs', 'Prefers practical gifts'],
    ['Mrs. Claus', '🤶', 'Claus household', 'Cookie cutter set\nA really good mystery novel', 'Loves cinnamon'],
    ['Santa', '🎅', 'Claus household', 'Anything but cookies, honestly', 'XXL sweaters'],
    ['Buddy', '🧝', 'Elves', 'Maple syrup\nhttps://en.wikipedia.org/wiki/Etch_A_Sketch', 'Very enthusiastic'],
    ['Jingle', '🧝‍♀️', 'Elves', 'Glitter pens\nWool socks', ''],
    ['Frosty', '⛄', '', 'A new hat\nSunscreen (just in case)', 'Keep it cold'],
  ];
  const participants = people.map(([name, emoji, group, wishlist, notes]) =>
    createParticipant({ name, emoji, group, wishlist, notes }),
  );
  return createEvent({
    name: `North Pole Office Party ${year}`,
    date: `${year}-12-18`,
    time: '17:30',
    budget: 25,
    currency: 'USD',
    location: 'Workshop break room',
    message: 'Ugly sweaters strongly encouraged. Gifts unwrapped after cocoa! ☕',
    organizer: 'The Head Elf',
    theme: 'classic',
    revealStyle: 'giftbox',
    participants,
    rules: { groupsExclusive: true, noReciprocal: true, exclusions: [], avoid: [] },
  });
}
