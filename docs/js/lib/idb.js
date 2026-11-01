// Stores non-extractable CryptoKeys in IndexedDB ("remember on this device" for sealed mode).
// Non-extractable means even code running on this page can use the key but never read its bytes.

const DB_NAME = 'secret-santa-keys';
const STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberKey(id, cryptoKey) {
  try {
    await tx('readwrite', (s) => s.put(cryptoKey, id));
    return true;
  } catch {
    return false;
  }
}

export async function recallKey(id) {
  try {
    return (await tx('readonly', (s) => s.get(id))) || null;
  } catch {
    return null;
  }
}

export async function forgetKey(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

export async function forgetAllKeys() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}
