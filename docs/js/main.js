// App shell: header, footer, settings, routing, service worker.
import { $, h, mount } from './lib/dom.js';
import { parseHash } from './router.js';
import { apply as applySettings, getSettings, onSettingsChange, reducedMotion, updateSettings } from './lib/settings.js';
import { persistent, clearAll, usageBytes } from './lib/storage.js';
import { forgetAllKeys } from './lib/idb.js';
import { setSnow } from './fx/snow.js';
import { icon } from './ui/icons.js';
import { openDialog, confirmDialog } from './ui/dialog.js';
import { clearToasts, toast } from './ui/toast.js';
import { toggle } from './ui/components.js';

import home from './views/home.js';
import newEvent from './views/new.js';
import eventView from './views/event.js';
import { revealRoute, sealedRoute, previewRoute } from './views/reveal.js';
import joinView from './views/join.js';
import addView from './views/add.js';
import partyView from './views/party.js';
import printView from './views/print.js';
import ideasView from './views/ideas.js';
import { wishlistBuilder, wishlistViewer } from './views/wishlist.js';
import aboutView from './views/about.js';
import notFound from './views/notfound.js';

const ROUTES = {
  '': home,
  new: newEvent,
  e: eventView,
  r: revealRoute,
  s: sealedRoute,
  preview: previewRoute,
  join: joinView,
  add: addView,
  party: partyView,
  print: printView,
  ideas: ideasView,
  wishlist: wishlistBuilder,
  w: wishlistViewer,
  about: aboutView,
};

// Routes that carry secrets: keep chrome minimal and never show other navigation noise.
const FOCUS_ROUTES = new Set(['r', 's', 'join', 'party']);

let cleanup = null;
let renderCount = 0;

async function render() {
  const { parts, query } = parseHash();
  const name = parts[0] || '';
  const view = ROUTES[name] || notFound;

  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (e) {
      console.error(e);
    }
  }
  cleanup = null;
  delete document.body.dataset.eventTheme;
  document.body.dataset.route = name || 'home';
  document.body.classList.toggle('focus-route', FOCUS_ROUTES.has(name));
  // Don't carry organizer notifications onto a participant's private page.
  if (FOCUS_ROUTES.has(name)) clearToasts();
  updateNav(name);
  closeMenu();

  const main = $('#main');
  const root = h('div', { class: 'view' });
  mount(main, root);
  const isFirst = renderCount++ === 0;
  if (!isFirst) window.scrollTo(0, 0);

  try {
    const result = await view({ root, parts, query });
    if (root.isConnected && typeof result === 'function') cleanup = result;
    else if (typeof result === 'function') result();
  } catch (e) {
    console.error(e);
    if (root.isConnected) {
      mount(
        root,
        h(
          'div',
          { class: 'container narrow page-pad' },
          h('h1', { tabindex: '-1' }, 'Something went wrong 😬'),
          h('p', { class: 'muted' }, e && e.message ? e.message : String(e)),
          h('p', h('a', { href: '#/', class: 'btn btn-primary' }, 'Back to start')),
        ),
      );
    }
  }

  if (!isFirst && root.isConnected) {
    const heading = root.querySelector('h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Header & navigation

const NAV = [
  { href: '#/', label: 'Exchanges', route: '', iconName: 'gift' },
  { href: '#/ideas', label: 'Gift ideas', route: 'ideas', iconName: 'lightbulb' },
  { href: '#/wishlist', label: 'Wishlist', route: 'wishlist', iconName: 'list-checks' },
  { href: '#/about', label: 'How it works', route: 'about', iconName: 'shield-check' },
];

let menuOpen = false;

function updateNav(route) {
  for (const a of document.querySelectorAll('.nav-link')) {
    const active = a.dataset.route === route || (a.dataset.route === '' && ['e', 'new', 'party', 'print', 'add', 'preview'].includes(route));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function closeMenu() {
  menuOpen = false;
  const btn = $('#menu-btn');
  const nav = $('#site-nav');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (nav) nav.classList.remove('open');
}

function buildHeader() {
  const nav = h(
    'nav',
    { id: 'site-nav', class: 'site-nav', 'aria-label': 'Main' },
    NAV.map((n) => h('a', { href: n.href, class: 'nav-link', dataset: { route: n.route } }, icon(n.iconName, { size: 18 }), h('span', n.label))),
    h('button', { type: 'button', class: 'nav-link nav-settings', onClick: openSettings }, icon('sliders-horizontal', { size: 18 }), h('span', 'Settings')),
  );
  const menuBtn = h(
    'button',
    {
      type: 'button',
      id: 'menu-btn',
      class: 'icon-btn menu-btn',
      'aria-label': 'Menu',
      'aria-expanded': 'false',
      'aria-controls': 'site-nav',
      onClick: () => {
        menuOpen = !menuOpen;
        menuBtn.setAttribute('aria-expanded', String(menuOpen));
        nav.classList.toggle('open', menuOpen);
      },
    },
    icon('menu'),
  );
  const soundBtn = h('button', {
    type: 'button',
    class: 'icon-btn sound-btn',
    'aria-label': 'Sounds',
    onClick: () => updateSettings({ sound: !getSettings().sound }),
  });
  const syncSound = () => {
    const on = getSettings().sound;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.title = on ? 'Sounds on (click to mute)' : 'Sounds off (click to unmute)';
    soundBtn.replaceChildren(icon(on ? 'volume-2' : 'volume-x'));
  };
  syncSound();
  onSettingsChange(syncSound);
  const header = h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'container header-inner' },
      h('a', { href: '#/', class: 'brand', 'aria-label': 'Secret Santa home' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '🎁'), h('span', { class: 'brand-name' }, 'Secret Santa')),
      nav,
      soundBtn,
      menuBtn,
    ),
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu();
      menuBtn.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (menuOpen && !header.contains(e.target)) closeMenu();
  });
  return header;
}

function sourceUrl() {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
  if (!m) return null;
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return repo ? `https://github.com/${m[1]}/${repo}` : `https://github.com/${m[1]}/${m[1]}.github.io`;
}

function buildFooter() {
  const src = sourceUrl();
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'container footer-inner' },
      h('p', '🎄 No accounts, no servers, no tracking. Everything stays in your browser and in the links you send.'),
      h(
        'p',
        { class: 'footer-links' },
        h('a', { href: '#/about' }, 'How it works & security'),
        h('a', { href: '#/ideas' }, 'Gift ideas'),
        src && h('a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, 'Source code'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Settings

function openSettings() {
  closeMenu();
  const st = getSettings();
  const themeGroup = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
    [
      ['system', 'Auto', 'monitor'],
      ['light', 'Light', 'sun'],
      ['dark', 'Dark', 'moon'],
    ].map(([v, label, ic]) =>
      h(
        'label',
        { class: 'segment' },
        h('input', { type: 'radio', name: 'theme', value: v, checked: st.theme === v, onChange: () => updateSettings({ theme: v }) }),
        h('span', icon(ic, { size: 16 }), label),
      ),
    ),
  );
  const usage = Math.max(1, Math.round(usageBytes() / 1024));
  openDialog({
    title: 'Settings',
    size: 'sm',
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Theme'), themeGroup),
      toggle({ label: 'Falling snow', iconName: 'snowflake', checked: st.snow, onChange: (v) => updateSettings({ snow: v }) }),
      toggle({ label: 'Sounds', description: 'Jingles and pops on reveal.', iconName: 'bell', checked: st.sound, onChange: (v) => updateSettings({ sound: v }) }),
      toggle({
        label: 'Reduce motion',
        description: 'Skip animations and confetti.',
        iconName: 'sparkles',
        checked: reducedMotion(),
        onChange: (v) => updateSettings({ motion: v ? 'reduce' : 'full' }),
      }),
      h('hr'),
      h('p', { class: 'muted small' }, `Your exchanges are stored only in this browser (${usage} KB). Export a backup from an exchange’s menu to move it to another device.`),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-danger-ghost',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Delete all data?',
              message: 'This permanently removes every exchange, setting and remembered key from this browser. Links you already sent keep working.',
              confirmLabel: 'Delete everything',
              danger: true,
            });
            if (!ok) return;
            clearAll();
            await forgetAllKeys();
            toast('All local data deleted', { type: 'success' });
            location.hash = '#/';
            location.reload();
          },
        },
        icon('trash', { size: 18 }),
        'Delete all local data',
      ),
    ),
  });
}

function syncEffects() {
  const st = getSettings();
  setSnow(st.snow && !reducedMotion() && document.body.dataset.route !== 'print');
}

// ---------------------------------------------------------------------------
// Boot

function boot() {
  applySettings();
  const app = $('#app');

  // Clickjacking defense: CSP frame-ancestors can't be set from a <meta> tag and GitHub
  // Pages doesn't send X-Frame-Options, so refuse to run inside someone else's frame.
  if (window.top !== window.self) {
    mount(
      app,
      h(
        'div',
        { class: 'container narrow page-pad center' },
        h('h1', 'Open Secret Santa in its own tab'),
        h('p', { class: 'muted' }, 'For your privacy, this app doesn’t run inside other websites.'),
        h('a', { href: location.href, target: '_top', rel: 'noopener', class: 'btn btn-primary' }, 'Open it directly'),
      ),
    );
    return;
  }

  const main = h('main', { id: 'main', class: 'site-main', tabindex: '-1' });
  mount(app, h('a', { href: '#main', class: 'skip-link', onClick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content'), buildHeader(), main, buildFooter());

  if (!persistent) {
    app.prepend(h('div', { class: 'banner banner-warn', role: 'status' }, icon('triangle-alert', { size: 18 }), 'Your browser is blocking storage, so exchanges won’t be saved after you close this tab. Export a backup before leaving.'));
  }
  if (!window.isSecureContext || !globalThis.crypto || !globalThis.crypto.subtle) {
    app.prepend(h('div', { class: 'banner banner-error', role: 'alert' }, icon('circle-alert', { size: 18 }), 'This page must be opened over https:// (or localhost) for its cryptography to work.'));
  }

  window.addEventListener('hashchange', () => {
    render().then(syncEffects);
  });
  onSettingsChange(syncEffects);
  render().then(syncEffects);

  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast('Something went wrong. Please try again.', { type: 'error' });
  });
  document.addEventListener('securitypolicyviolation', (e) => {
    console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const register = () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker registration failed', err));
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
  }
}

boot();
