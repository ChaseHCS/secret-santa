/* Service worker: offline support.
 * Network-first (with a short timeout) so a new deploy shows up immediately when online,
 * falling back to the precached copy when offline. Cache names are scoped to this site's
 * path because every GitHub Pages project of one account shares the same origin. */

// <generated-assets> (run `npm run build:sw` after changing files; a unit test checks this)
const VERSION = '608adfe4ace1';
const ASSETS = [
  './',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
  'index.html',
  'js/core/draw.js',
  'js/core/events.js',
  'js/core/merkle.js',
  'js/core/payload.js',
  'js/core/schema.js',
  'js/core/seal.js',
  'js/core/template.js',
  'js/data/currencies.js',
  'js/data/ideas.js',
  'js/fx/confetti.js',
  'js/fx/snow.js',
  'js/fx/sound.js',
  'js/lib/bytes.js',
  'js/lib/clipboard.js',
  'js/lib/compress.js',
  'js/lib/dom.js',
  'js/lib/emoji.js',
  'js/lib/format.js',
  'js/lib/ics.js',
  'js/lib/idb.js',
  'js/lib/linkify.js',
  'js/lib/random.js',
  'js/lib/settings.js',
  'js/lib/storage.js',
  'js/lib/words.js',
  'js/main.js',
  'js/router.js',
  'js/ui/components.js',
  'js/ui/countdown.js',
  'js/ui/dialog.js',
  'js/ui/gift.js',
  'js/ui/icons.js',
  'js/ui/qr.js',
  'js/ui/reveal.js',
  'js/ui/scratch.js',
  'js/ui/share.js',
  'js/ui/toast.js',
  'js/vendor/lucide-icons.js',
  'js/vendor/qrcode.js',
  'js/views/about.js',
  'js/views/add.js',
  'js/views/event-details.js',
  'js/views/event-people.js',
  'js/views/event-rules.js',
  'js/views/event-share.js',
  'js/views/event.js',
  'js/views/home.js',
  'js/views/ideas.js',
  'js/views/join.js',
  'js/views/new.js',
  'js/views/notfound.js',
  'js/views/party.js',
  'js/views/print.js',
  'js/views/reveal.js',
  'js/views/wishlist.js',
  'manifest.webmanifest',
];
// </generated-assets>

const PREFIX = 'secret-santa:';
const SCOPE = self.registration.scope;
const CACHE = `${PREFIX}${VERSION}:${SCOPE}`;
const TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key.endsWith(`:${SCOPE}`) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// Safari refuses redirected responses for navigations; rebuild them without the flag.
async function unredirect(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function handle(request, url) {
  const cache = await caches.open(CACHE);
  const isNav = request.mode === 'navigate';
  const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(url.href, res.clone()).catch(() => {});
    return res;
  });
  try {
    const res = await Promise.race([network, timeout(TIMEOUT_MS)]);
    return isNav ? unredirect(res) : res;
  } catch {
    const cached =
      (await cache.match(url.href, { ignoreSearch: true })) ||
      (isNav ? (await cache.match(new URL('./', SCOPE).href)) || (await cache.match(new URL('index.html', SCOPE).href)) : undefined);
    if (cached) return cached;
    const res = await network; // slow network but nothing cached: keep waiting
    return isNav ? unredirect(res) : res;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  event.respondWith(handle(request, url));
});
