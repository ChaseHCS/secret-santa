// Raw DEFLATE via the native Compression Streams API, with a hard cap on
// decompressed size so a malicious link can't be used as a decompression bomb.
import { concat } from './bytes.js';

export const MAX_INFLATED_BYTES = 256 * 1024;

export const hasDeflate = (() => {
  try {
    if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return false;
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
})();

async function readAll(readable, max) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      reader.cancel().catch(() => {});
      throw new Error('Decompressed data too large');
    }
    chunks.push(value);
  }
  return concat(...chunks);
}

async function pipe(bytes, stream, max) {
  const writer = stream.writable.getWriter();
  // Errors surface through the readable side; swallow writer-side rejections.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return readAll(stream.readable, max);
}

export async function deflate(bytes) {
  if (!hasDeflate) throw new Error('Compression not supported');
  return pipe(bytes, new CompressionStream('deflate-raw'), Infinity);
}

export async function inflate(bytes, max = MAX_INFLATED_BYTES) {
  if (!hasDeflate) {
    throw new Error('This browser cannot open compressed links. Please update your browser.');
  }
  return pipe(bytes, new DecompressionStream('deflate-raw'), max);
}
