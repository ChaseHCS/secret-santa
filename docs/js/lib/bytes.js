// Byte helpers: base64url, UTF-8, concatenation and a tiny binary reader/writer.
// Everything here is pure and works in browsers and Node 20+.

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(str) {
  return encoder.encode(String(str));
}

export function fromUtf8(bytes) {
  return strictDecoder.decode(bytes);
}

export function concat(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export function toB64url(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  if (typeof str !== 'string' || !B64URL_RE.test(str) || str.length % 4 === 1) {
    throw new Error('Invalid base64url data');
  }
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Binary writer with unsigned LEB128 varints. */
export class ByteWriter {
  constructor() {
    this.parts = [];
  }
  u8(v) {
    this.parts.push(Uint8Array.of(v & 0xff));
    return this;
  }
  u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    this.parts.push(b);
    return this;
  }
  varint(v) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError('varint out of range');
    const out = [];
    let n = v;
    do {
      let byte = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) byte |= 0x80;
      out.push(byte);
    } while (n > 0);
    this.parts.push(Uint8Array.from(out));
    return this;
  }
  raw(bytes) {
    this.parts.push(bytes);
    return this;
  }
  lenBytes(bytes) {
    this.varint(bytes.length);
    this.parts.push(bytes);
    return this;
  }
  str(s) {
    return this.lenBytes(utf8(s));
  }
  finish() {
    return concat(...this.parts);
  }
}

export class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }
  need(n) {
    if (n < 0 || this.pos + n > this.bytes.length) throw new Error('Unexpected end of data');
  }
  u8() {
    this.need(1);
    return this.bytes[this.pos++];
  }
  u32() {
    this.need(4);
    const v = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4).getUint32(0, false);
    this.pos += 4;
    return v;
  }
  varint() {
    let result = 0;
    let mult = 1;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result += (byte & 0x7f) * mult;
      if ((byte & 0x80) === 0) {
        if (result > 0xffffffff) throw new Error('varint too large');
        return result;
      }
      mult *= 128;
    }
    throw new Error('varint too long');
  }
  raw(n) {
    this.need(n);
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  lenBytes(max = 1 << 20) {
    const n = this.varint();
    if (n > max) throw new Error('Field too large');
    return this.raw(n);
  }
  str(max) {
    return fromUtf8(this.lenBytes(max));
  }
  rest() {
    const out = this.bytes.slice(this.pos);
    this.pos = this.bytes.length;
    return out;
  }
  end() {
    if (this.pos !== this.bytes.length) throw new Error('Trailing data');
  }
}

/** Small, fast, non-cryptographic 53-bit string hash (cyrb53). Used only for change detection. */
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
