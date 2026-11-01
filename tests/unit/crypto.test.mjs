import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '../../docs/js/lib/random.js';
import { utf8, fromUtf8 } from '../../docs/js/lib/bytes.js';
import { buildTree, fingerprint, getProof, leafHash, nodeHash, rootOf, verifyProof } from '../../docs/js/core/merkle.js';
import {
  WrongPassphraseError,
  createParticipantKey,
  keyId,
  normalizePassphrase,
  open,
  parseWrap,
  seal,
  unwrapParticipantKey,
} from '../../docs/js/core/seal.js';

const ITER = 1000; // fast for tests; production uses 600k

test('Merkle proofs verify for every leaf of trees of size 1..40', async () => {
  for (let n = 1; n <= 40; n++) {
    const leaves = [];
    for (let i = 0; i < n; i++) leaves.push(await leafHash(i, `g${i}`, `r${i}`, randomBytes(16)));
    const levels = await buildTree(leaves);
    const root = rootOf(levels);
    for (let i = 0; i < n; i++) {
      const proof = getProof(levels, i);
      assert.equal(await verifyProof(leaves[i], i, n, proof, root), true, `n=${n} i=${i}`);
      if (n > 1) {
        assert.equal(await verifyProof(leaves[i], (i + 1) % n, n, proof, root), false, 'wrong index');
        assert.equal(await verifyProof(leaves[(i + 1) % n], i, n, proof, root), false, 'wrong leaf');
      }
      if (proof.length) assert.equal(await verifyProof(leaves[i], i, n, proof.slice(1), root), false, 'short proof');
      assert.equal(await verifyProof(leaves[i], i, n, [...proof, root], root), false, 'long proof');
    }
  }
});

test('leaf and node hashes are domain-separated', async () => {
  const a = await leafHash(0, 'a', 'b', new Uint8Array(16));
  const b = await leafHash(0, 'a', 'b', new Uint8Array(16));
  assert.deepEqual(a, b);
  assert.notDeepEqual(await leafHash(1, 'a', 'b', new Uint8Array(16)), a);
  assert.notDeepEqual(await leafHash(0, 'ab', '', new Uint8Array(16)), await leafHash(0, 'a', 'b', new Uint8Array(16)), 'length-prefixed fields');
  assert.notDeepEqual(await nodeHash(a, b), a);
  const fp = fingerprint(a);
  assert.equal(fp.emoji.length, 4);
});

test('passphrase normalization', () => {
  assert.equal(normalizePassphrase('  Jolly Reindeer__Tinsel..42 '), 'jolly-reindeer-tinsel-42');
  assert.equal(normalizePassphrase('JOLLY-reindeer tinsel-42'), 'jolly-reindeer-tinsel-42');
  assert.equal(normalizePassphrase('ｊｏｌｌｙ'), 'jolly', 'NFKC folds full-width letters');
});

test('participant keys wrap/unwrap with the secret phrase', async () => {
  const eventId = 'abcdefghjk';
  const k = await createParticipantKey('jolly-reindeer-tinsel-cocoa-42', eventId, ITER);
  assert.equal(k.pub.length, 65);
  assert.equal(k.pub[0], 4);
  assert.equal(parseWrap(k.wrap).iterations, ITER);

  const priv = await unwrapParticipantKey(k.wrap, 'Jolly Reindeer Tinsel Cocoa 42', eventId);
  assert.equal(priv.extractable, false);
  await assert.rejects(() => unwrapParticipantKey(k.wrap, 'jolly-reindeer-tinsel-cocoa-43', eventId), WrongPassphraseError);
  await assert.rejects(() => unwrapParticipantKey(k.wrap, 'jolly-reindeer-tinsel-cocoa-42', 'otherevent'), WrongPassphraseError, 'wrapped key is bound to the exchange');
  assert.equal(typeof (await keyId(k.pub)), 'string');
});

test('seal/open round-trip, and AAD / wrong-key failures', async () => {
  const eventId = 'abcdefghjk';
  const alice = await createParticipantKey('alice phrase one two', eventId, ITER);
  const bob = await createParticipantKey('bob phrase three four', eventId, ITER);
  const aad = utf8('header');
  const box = await seal(alice.pub, utf8('You drew Bob 🎁'), aad);

  const priv = await unwrapParticipantKey(alice.wrap, 'alice phrase one two', eventId);
  assert.equal(fromUtf8(await open(box, priv, alice.pub, aad)), 'You drew Bob 🎁');
  assert.equal(fromUtf8(await open(box, alice.privateKey, alice.pub, aad)), 'You drew Bob 🎁', 'remembered key works');

  await assert.rejects(() => open(box, priv, alice.pub, utf8('tampered header')));
  await assert.rejects(() => open(box, bob.privateKey, bob.pub, aad));
  const flipped = box.slice();
  flipped[flipped.length - 1] ^= 1;
  await assert.rejects(() => open(flipped, priv, alice.pub, aad));
  await assert.rejects(() => seal(new Uint8Array(65), utf8('x'), aad));
});
