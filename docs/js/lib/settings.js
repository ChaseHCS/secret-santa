// User preferences (per browser).
import { getJSON, setJSON } from './storage.js';

const KEY = 'settings';
const DEFAULTS = { theme: 'system', snow: true, sound: true, motion: 'system' };
let current = { ...DEFAULTS, ...(getJSON(KEY, {}) || {}) };
const listeners = new Set();

export function getSettings() {
  return { ...current };
}

export function updateSettings(patch) {
  current = { ...current, ...patch };
  setJSON(KEY, current);
  apply();
  for (const fn of listeners) fn(getSettings());
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function isDark() {
  if (current.theme === 'dark') return true;
  if (current.theme === 'light') return false;
  return !!(darkQuery && darkQuery.matches);
}

export function reducedMotion() {
  if (current.motion === 'reduce') return true;
  if (current.motion === 'full') return false;
  return !!(motionQuery && motionQuery.matches);
}

export function apply() {
  const root = document.documentElement;
  if (current.theme === 'light' || current.theme === 'dark') root.dataset.theme = current.theme;
  else delete root.dataset.theme;
  root.dataset.motion = reducedMotion() ? 'reduce' : 'full';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark() ? '#0d1b1e' : '#b3122b');
}

darkQuery?.addEventListener?.('change', () => {
  apply();
  for (const fn of listeners) fn(getSettings());
});
motionQuery?.addEventListener?.('change', () => {
  apply();
  for (const fn of listeners) fn(getSettings());
});
