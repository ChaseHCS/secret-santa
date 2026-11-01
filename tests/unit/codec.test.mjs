import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ByteReader, ByteWriter, fromB64url, toB64url, utf8 } from '../../docs/js/lib/bytes.js';
import { deflate, hasDeflate, inflate } from '../../docs/js/lib/compress.js';
import { randomBytes, randomId, randomInt } from '../../docs/js/lib/random.js';
import {
  LinkError,
  buildRevealObject,
  decodeInvite,
  decodeJoin,
  decodeReveal,
  decodeWishlist,
  encodeInvite,
  encodeJoin,
  encodeReveal,
  encodeWishlist,
  extractData,
  findJoinCodes,
  linkFor,
  TYPE,
  verifyReveal,
} from '../../docs/js/core/payload.js';
import { buildTree, getProof, leafHash, rootOf } from '../../docs/js/core/merkle.js';
import { cleanDate, cleanEmail, cleanLine, cleanText } from '../../docs/js/core/schema.js';
import { renderTemplate } from '../../docs/js/core/template.js';

test('base64url round-trips and rejects junk', () => {
  for (let len = 0; len < 200; len++) {
    const b = randomBytes(len);
    const s = toB64url(b);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(fromB64url(s), b);
  }
  assert.throws(() => fromB64url('abc$'));
  assert.throws(() => fromB64url('a'));
  assert.throws(() => fromB64url('ab=='));
});

test('varints and binary reader bounds', () => {
  const values = [0, 1, 127, 128, 255, 16383, 16384, 2 ** 21, 2 ** 31, 2 ** 32 - 1];
  const w = new ByteWriter();
  for (const v of values) w.varint(v);
  w.str('héllo 🎄');
  const r = new ByteReader(w.finish());
  for (const v of values) assert.equal(r.varint(), v);
  assert.equal(r.str(), 'héllo 🎄');
  r.end();
  assert.throws(() => r.u8(), /Unexpected end/);
  assert.throws(() => new ByteWriter().varint(-1));
  assert.throws(() => new ByteReader(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0x01)).varint());
});

test('random helpers', () => {
  for (let i = 0; i < 1000; i++) {
    const n = 1 + (i % 17);
    const x = randomInt(n);
    assert.ok(x >= 0 && x < n && Number.isInteger(x));
  }
  assert.throws(() => randomInt(0));
  assert.match(randomId(), /^[a-z2-9]{12}$/);
  assert.notEqual(randomId(), randomId());
});

test('deflate round-trip and decompression-bomb guard', { skip: !hasDeflate }, async () => {
  const text = utf8('jingle bells '.repeat(500));
  const z = await deflate(text);
  assert.ok(z.length < text.length);
  assert.deepEqual(await inflate(z), text);
  const bomb = await deflate(new Uint8Array(2_000_000));
  await assert.rejects(() => inflate(bomb), /too large/);
  await assert.rejects(() => inflate(Uint8Array.of(1, 2, 3, 4, 5)));
});

async function sampleReveal(overrides = {}) {
  const salt = randomBytes(16);
  const leaves = [
    await leafHash(0, 'Zoë 🎄', 'Łukasz', salt),
    await leafHash(1, 'Łukasz', 'Zoë 🎄', randomBytes(16)),
    await leafHash(2, 'Ann', 'Bob', randomBytes(16)),
  ];
  const levels = await buildTree(leaves);
  const obj = buildRevealObject({
    event: { id: 'abcdefgh', n: 'Family 🎁 2026', d: '2026-12-24', t: '19:00', b: 50, c: 'EUR', l: 'Grandma’s', m: 'Line 1\nLine 2', o: 'Chase', th: 'frost', rs: 'scratch' },
    giver: { name: 'Zoë 🎄', emoji: '🦊' },
    recipient: { name: 'Łukasz', emoji: '🐧', wishlist: 'Socks\nhttps://example.com/x', notes: 'No nuts' },
    verification: { root: rootOf(levels), index: 0, count: 3, salt, proof: getProof(levels, 0) },
    ...overrides,
  });
  return obj;
}

test('reveal payload round-trip with unicode and verification', async () => {
  const obj = await sampleReveal();
  const data = await encodeReveal(obj);
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  const r = await decodeReveal(data);
  assert.equal(r.g, 'Zoë 🎄');
  assert.equal(r.r, 'Łukasz');
  assert.equal(r.ra, '🐧');
  assert.equal(r.w, 'Socks\nhttps://example.com/x');
  assert.equal(r.ev.n, 'Family 🎁 2026');
  assert.equal(r.ev.b, 50);
  assert.equal(r.ev.th, 'frost');
  assert.equal(r.ev.rs, 'scratch');
  const v = await verifyReveal(r);
  assert.equal(v.status, 'verified');
  assert.match(v.fingerprint.code, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(v.fingerprint.emoji.length, 4);

  // Messaging apps sometimes glue punctuation onto links.
  const r2 = await decodeReveal(`${data}).`);
  assert.equal(r2.r, 'Łukasz');
  assert.equal(extractData('abc_-123!?'), 'abc_-123');
});

test('tampering with a reveal payload is detected by the Merkle proof', async () => {
  const obj = await sampleReveal();
  obj.r = 'Ann';
  const r = await decodeReveal(await encodeReveal(obj));
  assert.equal((await verifyReveal(r)).status, 'failed');
});

test('broken links raise friendly LinkErrors', async () => {
  const data = await encodeReveal(await sampleReveal());
  await assert.rejects(() => decodeReveal(data.slice(0, 20)), LinkError);
  await assert.rejects(() => decodeReveal(''), LinkError);
  await assert.rejects(() => decodeReveal('!!!'), LinkError);
  const wl = await encodeWishlist({ n: 'Ann', w: 'x' });
  await assert.rejects(() => decodeReveal(wl), /different page/);
});

test('untrusted fields are sanitized on decode', async () => {
  const obj = await sampleReveal();
  obj.g = 'Evil‮Name\u0000';
  obj.ga = '<img src=x>';
  obj.ev.th = 'javascript:alert(1)';
  obj.ev.d = '2026-02-30';
  obj.ev.b = -5;
  obj.w = 'x'.repeat(5000);
  const r = await decodeReveal(await encodeReveal(obj));
  assert.equal(r.g, 'Evil Name');
  assert.equal(r.ga, '');
  assert.equal(r.ev.th, 'classic');
  assert.equal(r.ev.d, '');
  assert.equal(r.ev.b, null);
  assert.equal(r.w.length, 1000);
});

test('join, invite and wishlist payloads round-trip', async () => {
  const join = { e: 'abcdefgh', n: 'Ann', a: '🐻', w: 'Books', no: 'Size M', em: 'ann@example.com' };
  const j = await decodeJoin(await encodeJoin(join));
  assert.deepEqual({ ...j }, { ...join, k: null, wr: null });

  const inv = await decodeInvite(await encodeInvite({ ev: { id: 'abcdefgh', n: 'Office' }, s: true }));
  assert.equal(inv.ev.n, 'Office');
  assert.equal(inv.s, true);

  const wl = await decodeWishlist(await encodeWishlist({ n: 'Bob', a: '🎸', w: 'Picks\nStrings', no: '' }));
  assert.equal(wl.w, 'Picks\nStrings');

  const badKey = await encodeJoin({ e: 'abcdefgh', n: 'X', k: 'bad', wr: 'bad' });
  await assert.rejects(() => decodeJoin(badKey), /damaged key/);
});

test('findJoinCodes extracts codes from messy pasted text', async () => {
  const a = await encodeJoin({ e: 'abcdefgh', n: 'Ann' });
  const b = await encodeJoin({ e: 'abcdefgh', n: 'Bob' });
  const text = `Hi! here: ${linkFor(TYPE.JOIN, a, 'https://x.github.io/ss/')}\n\nand ${linkFor(TYPE.JOIN, b, 'https://x.github.io/ss/')}.`;
  assert.deepEqual(findJoinCodes(text), [a, b]);
  assert.deepEqual(findJoinCodes(`${a}  ${a}`), [a]);
});

test('schema helpers', () => {
  assert.equal(cleanLine('  a \n b  ', 10), 'a b');
  assert.equal(cleanLine('🎄🎄🎄', 2), '🎄🎄');
  assert.equal(cleanText('a\r\n\r\n\r\n\r\nb', 100), 'a\n\nb');
  assert.equal(cleanDate('2026-12-24'), '2026-12-24');
  assert.equal(cleanDate('2026-13-01'), '');
  assert.equal(cleanEmail('ann@example.com'), 'ann@example.com');
  assert.equal(cleanEmail('nope'), '');
});

test('message templates drop lines whose placeholders are empty', () => {
  const text = renderTemplate('', { name: 'Ann', event: 'Office', link: 'https://x/#/r/abc', date: '', budget: '$20', organizer: '', sealed: '' });
  assert.match(text, /Hi Ann!/);
  assert.match(text, /Budget: \$20/);
  assert.doesNotMatch(text, /📅/);
  assert.doesNotMatch(text, /—/);
  const custom = renderTemplate('Yo {name}, {unknown}', { name: 'Bo', link: 'L' });
  assert.equal(custom, 'Yo Bo, {unknown}\nL', 'link is always included');
});
