// Hash router. All app state lives after the '#', so GitHub Pages only ever serves
// index.html and never receives anything sensitive.

export function parseHash(hash = location.hash) {
  let path = String(hash || '').replace(/^#/, '');
  if (!path.startsWith('/')) path = `/${path}`;
  const q = path.indexOf('?');
  const query = new URLSearchParams(q >= 0 ? path.slice(q + 1) : '');
  if (q >= 0) path = path.slice(0, q);
  const parts = path.split('/').filter(Boolean);
  return { parts, query, path };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    history.replaceState(history.state, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

// Events created with "Start an exchange" live here until their first edit, so
// abandoned blank exchanges never clutter storage.
const pending = new Map();
export function setPendingEvent(ev) {
  pending.set(ev.id, ev);
}
export function takePendingEvent(id) {
  return pending.get(id) || null;
}
export function clearPendingEvent(id) {
  pending.delete(id);
}
