// Draw commitment: a SHA-256 Merkle tree over salted (index, giver, recipient) leaves.
//
// Every link carries the root plus a short inclusion proof for its own leaf, so each
// participant can check that their match belongs to the same committed draw as
// everyone else's (compare the fingerprint). Leaves are salted with 128 random bits,
// so the sibling hashes in a proof reveal nothing about other people's matches.
// Leaves and inner nodes are domain-separated (0x00 / 0x01 prefixes, as in RFC 6962).

import { ByteWriter, concat, equalBytes } from '../lib/bytes.js';

async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export async function leafHash(index, giver, recipient, salt) {
  const w = new ByteWriter().u8(0x00).u32(index).str(giver).str(recipient).lenBytes(salt);
  return sha256(w.finish());
}

export async function nodeHash(left, right) {
  return sha256(concat(Uint8Array.of(0x01), left, right));
}

/** Returns all levels, leaves first. An odd node at the end of a level is promoted unchanged. */
export async function buildTree(leaves) {
  if (!leaves.length) throw new Error('Empty tree');
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? await nodeHash(prev[i], prev[i + 1]) : prev[i]);
    }
    levels.push(next);
  }
  return levels;
}

export function rootOf(levels) {
  return levels[levels.length - 1][0];
}

export function getProof(levels, index) {
  const proof = [];
  let idx = index;
  for (let lv = 0; lv < levels.length - 1; lv++) {
    const sib = idx ^ 1;
    if (sib < levels[lv].length) proof.push(levels[lv][sib]);
    idx >>= 1;
  }
  return proof;
}

export async function verifyProof(leaf, index, count, proof, root) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) return false;
  let h = leaf;
  let idx = index;
  let size = count;
  let p = 0;
  while (size > 1) {
    const sib = idx ^ 1;
    if (sib < size) {
      if (p >= proof.length) return false;
      h = idx & 1 ? await nodeHash(proof[p], h) : await nodeHash(h, proof[p]);
      p++;
    }
    idx >>= 1;
    size = Math.ceil(size / 2);
  }
  return p === proof.length && equalBytes(h, root);
}

// 64 distinct, widely supported emoji. 64 divides 256, so `byte & 63` is unbiased.
export const FINGERPRINT_EMOJI = [
  '🎄', '🎁', '⛄', '🦌', '🔔', '🌟', '🍪', '🧦', '🎅', '❄️', '🕯️', '🍬', '🎀', '🧣', '🧤', '🥛',
  '🍫', '🎶', '🦉', '🐧', '🐻', '🦊', '🐰', '🐱', '🐶', '🐼', '🦁', '🐸', '🐙', '🦋', '🐢', '🐳',
  '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🥕', '🌽', '🍄', '🌵', '🌻', '🌙', '⭐', '🔥', '🌈', '☕',
  '🎈', '🎨', '🎸', '🎲', '🚀', '🚂', '⛵', '🏔️', '🗝️', '📯', '💎', '👑', '🎩', '🎯', '🧸', '🥨',
];

/** Short human-comparable fingerprint for a 32-byte root. */
export function fingerprint(root) {
  const hex = Array.from(root.slice(0, 4), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const emoji = Array.from(root.slice(4, 8), (b) => FINGERPRINT_EMOJI[b & 63]);
  return { code: `${hex.slice(0, 4)}-${hex.slice(4)}`, emoji };
}
