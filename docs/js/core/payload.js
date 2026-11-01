// Link payloads. Everything lives in the URL fragment (#...), which browsers never
// send to the web server, so GitHub Pages never sees anyone's match.
//
// Binary container: [type:u8][flags:u8][body…] → base64url
//   1 REVEAL   body = JSON (raw-deflated when smaller)       route #/r/
//   2 SEALED   body = header JSON ‖ wrapped key ‖ sealed box  route #/s/
//   3 JOIN     sign-up reply sent to the organizer             route #/add/
//   4 INVITE   sign-up invitation                              route #/join/
//   5 WISHLIST standalone wishlist                             route #/w/

import { ByteReader, ByteWriter, concat, fromB64url, fromUtf8, toB64url, utf8 } from '../lib/bytes.js';
import { deflate, hasDeflate, inflate } from '../lib/compress.js';
import { leafHash, verifyProof, fingerprint } from './merkle.js';
import {
  LIMITS,
  THEMES,
  cleanEmail,
  cleanEmoji,
  cleanEnum,
  cleanEventDetails,
  cleanId,
  cleanLine,
  cleanText,
} from './schema.js';
import { validatePublicKey, parseWrap } from './seal.js';

export const TYPE = Object.freeze({ REVEAL: 1, SEALED: 2, JOIN: 3, INVITE: 4, WISHLIST: 5 });
export const ROUTE = Object.freeze({ 1: 'r', 2: 's', 3: 'add', 4: 'join', 5: 'w' });
const FLAG_DEFLATE = 1;
const MAX_LINK_CHARS = 64 * 1024;

export class LinkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LinkError';
  }
}

/** Keep only the leading base64url run (messaging apps sometimes append punctuation). */
export function extractData(str) {
  const m = /^[A-Za-z0-9_-]+/.exec(String(str || ''));
  return m ? m[0] : '';
}

async function packJsonBytes(type, obj) {
  const json = utf8(JSON.stringify(obj));
  let body = json;
  let flags = 0;
  if (hasDeflate) {
    const z = await deflate(json);
    if (z.length < json.length) {
      body = z;
      flags = FLAG_DEFLATE;
    }
  }
  return concat(Uint8Array.of(type, flags), body);
}

async function unpackJsonBytes(bytes, expectedType) {
  if (bytes.length < 3) throw new LinkError('This link is incomplete.');
  if (bytes[0] !== expectedType) throw new LinkError('This link is for a different page.');
  const flags = bytes[1];
  if (flags & ~FLAG_DEFLATE) throw new LinkError('This link was made by a newer version of the site.');
  const body = bytes.subarray(2);
  let json;
  try {
    const raw = flags & FLAG_DEFLATE ? await inflate(body) : body;
    json = JSON.parse(fromUtf8(raw));
  } catch (e) {
    if (/update your browser/i.test(e.message)) throw new LinkError(e.message);
    throw new LinkError('This link looks damaged or incomplete. Ask for it to be sent again.');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new LinkError('This link looks damaged.');
  return json;
}

function decodeData(data) {
  const clean = extractData(data);
  if (!clean || clean.length > MAX_LINK_CHARS) throw new LinkError('This link looks damaged or incomplete.');
  try {
    return fromB64url(clean);
  } catch {
    throw new LinkError('This link looks damaged or incomplete. Make sure you copied all of it.');
  }
}

export function baseUrl() {
  return String(globalThis.location?.href || 'https://example.invalid/').split('#')[0];
}

export function linkFor(type, data, base = baseUrl()) {
  return `${base}#/${ROUTE[type]}/${data}`;
}

// ---------------------------------------------------------------------------
// Reveal payload

function b64(bytes) {
  return toB64url(bytes);
}

function bytesField(v, len) {
  if (typeof v !== 'string') return null;
  try {
    const b = fromB64url(v);
    return b.length === len ? b : null;
  } catch {
    return null;
  }
}

export function buildRevealObject({ event, giver, recipient, verification }) {
  const obj = {
    ev: event,
    g: giver.name,
    ga: giver.emoji || '',
    r: recipient.name,
    ra: recipient.emoji || '',
    w: recipient.wishlist || '',
    no: recipient.notes || '',
  };
  if (verification) {
    obj.v = {
      root: b64(verification.root),
      i: verification.index,
      n: verification.count,
      s: b64(verification.salt),
      p: verification.proof.map(b64),
    };
  }
  return obj;
}

export function sanitizeReveal(o) {
  const out = {
    ev: cleanEventDetails(o.ev),
    g: cleanLine(o.g, LIMITS.name),
    ga: cleanEmoji(o.ga),
    r: cleanLine(o.r, LIMITS.name),
    ra: cleanEmoji(o.ra),
    w: cleanText(o.w, LIMITS.wishlist),
    no: cleanText(o.no, LIMITS.notes),
    v: null,
  };
  if (!out.g || !out.r) throw new LinkError('This link is missing its names. Ask for it to be sent again.');
  const v = o.v;
  if (v && typeof v === 'object') {
    const root = bytesField(v.root, 32);
    const salt = bytesField(v.s, 16);
    const n = Number.isInteger(v.n) && v.n >= 1 && v.n <= 10000 ? v.n : null;
    const i = Number.isInteger(v.i) && n !== null && v.i >= 0 && v.i < n ? v.i : null;
    const proof = Array.isArray(v.p) && v.p.length <= 20 ? v.p.map((x) => bytesField(x, 32)) : null;
    if (root && salt && n !== null && i !== null && proof && proof.every(Boolean)) {
      out.v = { root, salt, count: n, index: i, proof };
    }
  }
  return out;
}

export async function encodeRevealBytes(obj) {
  return packJsonBytes(TYPE.REVEAL, obj);
}

export async function encodeReveal(obj) {
  return toB64url(await encodeRevealBytes(obj));
}

export async function decodeRevealBytes(bytes) {
  return sanitizeReveal(await unpackJsonBytes(bytes, TYPE.REVEAL));
}

export async function decodeReveal(data) {
  return decodeRevealBytes(decodeData(data));
}

/** Check the Merkle inclusion proof embedded in a reveal payload. */
export async function verifyReveal(reveal) {
  if (!reveal.v) return { status: 'none' };
  const { root, salt, index, count, proof } = reveal.v;
  const leaf = await leafHash(index, reveal.g, reveal.r, salt);
  const ok = await verifyProof(leaf, index, count, proof, root);
  return { status: ok ? 'verified' : 'failed', fingerprint: fingerprint(root), count };
}

// ---------------------------------------------------------------------------
// Sealed payload

export function sanitizeSealedHeader(h) {
  const o = h && typeof h === 'object' ? h : {};
  const pub = bytesField(o.k, 65);
  const out = {
    e: cleanId(o.e),
    en: cleanLine(o.en, LIMITS.eventName) || 'Secret Santa',
    g: cleanLine(o.g, LIMITS.name),
    ga: cleanEmoji(o.ga),
    th: cleanEnum(o.th, THEMES, 'classic'),
    pub,
  };
  if (!out.e || !out.g || !pub || !validatePublicKey(pub)) throw new LinkError('This sealed link looks damaged.');
  return out;
}

/** Serialize a sealed-link header {e, en, g, ga, th, k(b64 pub)}; these exact bytes are the AAD. */
export function sealedHeaderBytes(header) {
  return utf8(JSON.stringify(header));
}

/** Returns base64url data. `headerBytes` must be the same bytes used as AAD when sealing. */
export function encodeSealed(headerBytes, wrap, sealedBox) {
  const bytes = new ByteWriter().u8(TYPE.SEALED).u8(0).lenBytes(headerBytes).lenBytes(wrap).raw(sealedBox).finish();
  return toB64url(bytes);
}

export function headerAad(headerBytes) {
  return concat(utf8('secret-santa/sealed-header/v1|'), headerBytes);
}

export function decodeSealed(data) {
  const bytes = decodeData(data);
  try {
    const r = new ByteReader(bytes);
    if (r.u8() !== TYPE.SEALED) throw new LinkError('This link is for a different page.');
    if (r.u8() !== 0) throw new LinkError('This link was made by a newer version of the site.');
    const headerBytes = r.lenBytes(4096);
    const wrap = r.lenBytes(1024);
    parseWrap(wrap);
    const sealedBox = r.rest();
    if (sealedBox.length < 65 + 12 + 16) throw new Error('short');
    const header = sanitizeSealedHeader(JSON.parse(fromUtf8(headerBytes)));
    return { header, headerBytes, wrap, sealedBox };
  } catch (e) {
    if (e instanceof LinkError) throw e;
    throw new LinkError('This sealed link looks damaged or incomplete. Ask for it to be sent again.');
  }
}

// ---------------------------------------------------------------------------
// Join code (participant → organizer)

export function sanitizeJoin(o) {
  const out = {
    e: cleanId(o.e),
    n: cleanLine(o.n, LIMITS.name),
    a: cleanEmoji(o.a),
    w: cleanText(o.w, LIMITS.wishlist),
    no: cleanText(o.no, LIMITS.notes),
    em: cleanEmail(o.em),
    k: null,
    wr: null,
  };
  if (!out.e || !out.n) throw new LinkError('This sign-up code is missing information.');
  if (o.k !== undefined || o.wr !== undefined) {
    const pub = bytesField(o.k, 65);
    let wrap = null;
    try {
      wrap = typeof o.wr === 'string' ? fromB64url(o.wr) : null;
      if (wrap) parseWrap(wrap);
    } catch {
      wrap = null;
    }
    if (!pub || !validatePublicKey(pub) || !wrap) throw new LinkError('This sign-up code has a damaged key.');
    out.k = o.k;
    out.wr = o.wr;
  }
  return out;
}

export async function encodeJoin(obj) {
  return toB64url(await packJsonBytes(TYPE.JOIN, obj));
}

export async function decodeJoin(data) {
  return sanitizeJoin(await unpackJsonBytes(decodeData(data), TYPE.JOIN));
}

/** Find every join code in pasted text (full links or bare codes). */
export function findJoinCodes(text) {
  const found = [];
  const re = /#\/add\/([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(text))) found.push(m[1]);
  if (!found.length) {
    for (const token of String(text).split(/\s+/)) {
      if (/^[A-Za-z0-9_-]{24,}$/.test(token)) found.push(token);
    }
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Invite (organizer → participants, for sign-ups)

export function sanitizeInvite(o) {
  const ev = cleanEventDetails(o.ev);
  if (!ev.id) throw new LinkError('This invite link is missing its exchange id.');
  return { ev, s: o.s === true };
}

export async function encodeInvite(obj) {
  return toB64url(await packJsonBytes(TYPE.INVITE, obj));
}

export async function decodeInvite(data) {
  return sanitizeInvite(await unpackJsonBytes(decodeData(data), TYPE.INVITE));
}

// ---------------------------------------------------------------------------
// Standalone wishlist

export function sanitizeWishlist(o) {
  const out = {
    n: cleanLine(o.n, LIMITS.name),
    a: cleanEmoji(o.a),
    w: cleanText(o.w, LIMITS.wishlist),
    no: cleanText(o.no, LIMITS.notes),
  };
  if (!out.n) throw new LinkError('This wishlist link is missing a name.');
  return out;
}

export async function encodeWishlist(obj) {
  return toB64url(await packJsonBytes(TYPE.WISHLIST, obj));
}

export async function decodeWishlist(data) {
  return sanitizeWishlist(await unpackJsonBytes(decodeData(data), TYPE.WISHLIST));
}
