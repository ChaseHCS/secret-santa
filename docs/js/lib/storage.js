// localStorage wrapper that never throws. Falls back to memory when storage is
// blocked (some private modes, disabled site data) so the app keeps working.

const PREFIX = 'secret-santa:';
const memory = new Map();

function probe() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const k = `${PREFIX}__probe`;
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

const ls = probe();
export const persistent = !!ls;

export function getRaw(key) {
  const k = PREFIX + key;
  try {
    if (ls) return ls.getItem(k);
  } catch {
    /* fall through */
  }
  return memory.has(k) ? memory.get(k) : null;
}

export function getJSON(key, fallback = null) {
  const raw = getRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** @returns {boolean} false if the value could not be saved (e.g. quota exceeded). */
export function setJSON(key, value) {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  if (ls) {
    try {
      ls.setItem(k, raw);
      return true;
    } catch {
      return false;
    }
  }
  memory.set(k, raw);
  return true;
}

export function remove(key) {
  const k = PREFIX + key;
  try {
    if (ls) ls.removeItem(k);
  } catch {
    /* ignore */
  }
  memory.delete(k);
}

/** Keys (without the global prefix) that start with `prefix`. */
export function keys(prefix = '') {
  const out = new Set();
  const full = PREFIX + prefix;
  try {
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(full)) out.add(k.slice(PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  for (const k of memory.keys()) if (k.startsWith(full)) out.add(k.slice(PREFIX.length));
  return [...out];
}

export function clearAll() {
  for (const k of keys('')) remove(k);
}

export function usageBytes() {
  let total = 0;
  for (const k of keys('')) total += (getRaw(k) || '').length * 2;
  return total;
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export const STORAGE_PREFIX = PREFIX;
