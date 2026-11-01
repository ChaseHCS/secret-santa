// Cryptographically secure randomness helpers (Web Crypto getRandomValues).
// randomInt() uses rejection sampling so results have no modulo bias.

const POOL_SIZE = 256;
const pool = new Uint32Array(POOL_SIZE);
let poolIndex = POOL_SIZE;

function nextUint32() {
  if (poolIndex >= POOL_SIZE) {
    globalThis.crypto.getRandomValues(pool);
    poolIndex = 0;
  }
  return pool[poolIndex++];
}

const TWO_32 = 0x100000000;

/** Uniform random integer in [0, n). */
export function randomInt(n) {
  if (!Number.isInteger(n) || n <= 0 || n > TWO_32) throw new RangeError(`randomInt: bad bound ${n}`);
  if (n === 1) return 0;
  const limit = TWO_32 - (TWO_32 % n);
  let x;
  do {
    x = nextUint32();
  } while (x >= limit);
  return x % n;
}

/** The default RNG object used by the draw engine. Tests can pass their own `{ int(n) }`. */
export const cryptoRng = Object.freeze({ int: randomInt });

export function randomBytes(n) {
  const out = new Uint8Array(n);
  // getRandomValues is limited to 65536 bytes per call.
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 symbols, no look-alikes

/** Random identifier; 32-symbol alphabet so `byte & 31` is unbiased. 12 chars = 60 bits. */
export function randomId(length = 12) {
  const bytes = randomBytes(length);
  let s = '';
  for (const b of bytes) s += ID_ALPHABET[b & 31];
  return s;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(arr, rng = cryptoRng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function pick(arr, rng = cryptoRng) {
  return arr[rng.int(arr.length)];
}
