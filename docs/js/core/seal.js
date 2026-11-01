// Sealed mode cryptography (Web Crypto only, no third-party code).
//
// Participant, at sign-up:
//   * generates an ECDH P-256 key pair
//   * wraps the private key (d‖x‖y, 96 bytes) with AES-256-GCM under a key derived from
//     their secret phrase: PBKDF2-HMAC-SHA256, 600k iterations, 16-byte random salt.
//     AAD binds the wrapped key to the exchange id.
//   * sends the organizer only {public key, wrapped private key}.
//
// Organizer, at draw time, encrypts each person's match to their public key (ECIES):
//   ephemeral ECDH P-256 → shared secret → HKDF-SHA256(salt = ephPub‖recipientPub,
//   info = "secret-santa/seal/v1") → AES-256-GCM, with the link's cleartext header as AAD.
//
// Only someone who knows the secret phrase can unwrap the private key and read the match.
// The organizer's browser never stores the plaintext of sealed matches.

import { ByteReader, ByteWriter, concat, fromB64url, toB64url, utf8 } from '../lib/bytes.js';
import { randomBytes } from '../lib/random.js';

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('Secure cryptography is unavailable. Open this page over https://.');
  return s;
};

export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 5_000_000;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const WRAP_AAD = 'secret-santa/wrap/v1|';
const SEAL_INFO = 'secret-santa/seal/v1';

export class WrongPassphraseError extends Error {
  constructor() {
    super('That secret phrase doesn’t match.');
    this.name = 'WrongPassphraseError';
  }
}

/** Case-insensitive; any run of spaces, dashes, underscores or dots counts as one separator. */
export function normalizePassphrase(p) {
  return String(p ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.·•]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

async function passphraseKey(passphrase, salt, iterations, usage) {
  const material = await subtle().importKey('raw', utf8(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

function jwkFromDxy(dxy) {
  return {
    kty: 'EC',
    crv: 'P-256',
    d: toB64url(dxy.subarray(0, 32)),
    x: toB64url(dxy.subarray(32, 64)),
    y: toB64url(dxy.subarray(64, 96)),
    ext: false,
  };
}

/**
 * Create a participant key pair protected by a secret phrase.
 * @returns {Promise<{pub:Uint8Array, wrap:Uint8Array, privateKey:CryptoKey}>}
 */
export async function createParticipantKey(passphrase, eventId, iterations = DEFAULT_ITERATIONS) {
  if (normalizePassphrase(passphrase).length < 1) throw new Error('Empty secret phrase');
  const s = subtle();
  const pair = await s.generateKey(ECDH, true, ['deriveBits']);
  const pub = new Uint8Array(await s.exportKey('raw', pair.publicKey));
  const jwk = await s.exportKey('jwk', pair.privateKey);
  const dxy = concat(fromB64url(jwk.d), fromB64url(jwk.x), fromB64url(jwk.y));
  if (dxy.length !== 96) throw new Error('Unexpected key size');

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await passphraseKey(passphrase, salt, iterations, 'encrypt');
  const ct = new Uint8Array(
    await s.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(WRAP_AAD + eventId) }, key, dxy),
  );
  const wrap = new ByteWriter().u8(1).u32(iterations).raw(salt).raw(iv).raw(ct).finish();
  const privateKey = await s.importKey('jwk', jwkFromDxy(dxy), ECDH, false, ['deriveBits']);
  dxy.fill(0);
  return { pub, wrap, privateKey };
}

export function parseWrap(wrap) {
  const r = new ByteReader(wrap);
  const version = r.u8();
  if (version !== 1) throw new Error('Unsupported key format');
  const iterations = r.u32();
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Unsupported key parameters');
  const salt = r.raw(16);
  const iv = r.raw(12);
  const ct = r.raw(96 + 16);
  r.end();
  return { iterations, salt, iv, ct };
}

/** Unwrap a participant's private key. Throws WrongPassphraseError on a bad phrase. */
export async function unwrapParticipantKey(wrap, passphrase, eventId) {
  const { iterations, salt, iv, ct } = parseWrap(wrap);
  const s = subtle();
  const key = await passphraseKey(passphrase, salt, iterations, 'decrypt');
  let dxy;
  try {
    dxy = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(WRAP_AAD + eventId) }, key, ct));
  } catch {
    throw new WrongPassphraseError();
  }
  try {
    return await s.importKey('jwk', jwkFromDxy(dxy), ECDH, false, ['deriveBits']);
  } finally {
    dxy.fill(0);
  }
}

export function validatePublicKey(pub) {
  return pub instanceof Uint8Array && pub.length === 65 && pub[0] === 0x04;
}

async function sealKey(sharedBits, ephPub, recipientPub, usage) {
  const s = subtle();
  const ikm = await s.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephPub, recipientPub), info: utf8(SEAL_INFO) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/** Encrypt `plaintext` to a participant's public key. Output: ephPub(65) ‖ iv(12) ‖ ciphertext. */
export async function seal(recipientPub, plaintext, aad) {
  if (!validatePublicKey(recipientPub)) throw new Error('Invalid public key');
  const s = subtle();
  const recipientKey = await s.importKey('raw', recipientPub, ECDH, false, []);
  const eph = await s.generateKey(ECDH, false, ['deriveBits']);
  const ephPub = new Uint8Array(await s.exportKey('raw', eph.publicKey));
  const shared = await s.deriveBits({ name: 'ECDH', public: recipientKey }, eph.privateKey, 256);
  const key = await sealKey(shared, ephPub, recipientPub, 'encrypt');
  const iv = randomBytes(12);
  const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext));
  return concat(ephPub, iv, ct);
}

export async function open(sealed, privateKey, recipientPub, aad) {
  if (sealed.length < 65 + 12 + 16) throw new Error('Sealed data too short');
  const s = subtle();
  const ephPub = sealed.subarray(0, 65);
  const iv = sealed.subarray(65, 77);
  const ct = sealed.subarray(77);
  const ephKey = await s.importKey('raw', ephPub, ECDH, false, []);
  const shared = await s.deriveBits({ name: 'ECDH', public: ephKey }, privateKey, 256);
  const key = await sealKey(shared, ephPub, recipientPub, 'decrypt');
  try {
    return new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct));
  } catch {
    throw new Error('This sealed link could not be decrypted. It may be damaged, or it was made for a different key.');
  }
}

/** Stable short id for a public key (used to find a remembered key on this device). */
export async function keyId(pub) {
  const h = new Uint8Array(await subtle().digest('SHA-256', pub));
  return toB64url(h.subarray(0, 12));
}
