/* Royal Luxury Mini Estate — Service Worker
   Bump CACHE_VERSION whenever you upload a new index.html so users get the update. */
const CACHE_VERSION = 'rlme-v2';
const SHELL_CACHE   = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './logo.jpg',
  './icon-48.png', './icon-72.png', './icon-96.png', './icon-128.png',
  './icon-144.png', './icon-152.png', './icon-167.png', './icon-180.png',
  './icon-192.png', './icon-256.png', './icon-384.png', './icon-512.png',
  './icon-maskable-192.png', './icon-maskable-512.png'
];

// Third-party static assets that are safe to cache (fonts + JS libraries).
// Firebase data/auth calls (firestore.googleapis.com, identitytoolkit, etc.) are NEVER cached.
function isCacheableCdn(url) {
  return url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com' ||
         url.hostname === 'cdnjs.cloudflare.com' ||
         (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // add one by one so a single missing file can't break the whole install
      .then((cache) => Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => null))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// The page can ask a waiting worker to take over immediately
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Page navigations: network first, fall back to cached app shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 2) Same-origin static files (icons, manifest…): cache first, refresh in background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3) Fonts + CDN libraries: stale-while-revalidate
  if (isCacheableCdn(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
  }
  // 4) Everything else (Firebase, images from storage, etc.) goes straight to the network
});
