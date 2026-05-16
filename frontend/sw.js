// Family HQ — minimal service worker.
// Strategy: network-first for everything (API + shell), with offline-cache fallback for shell.
// We deliberately do NOT cache /api/* responses — data should always be fresh.

const CACHE_NAME = 'family-hq-shell-v1';
const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept API — always live
  if (url.pathname.startsWith('/api/')) return;

  // Weather backgrounds: cache-first (immutable assets, big files, must work offline)
  if (url.pathname.startsWith('/static/weather/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Network-first for shell, fall back to cache offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache only same-origin successful responses for known shell paths
        if (
          res.ok &&
          url.origin === self.location.origin &&
          (SHELL_URLS.includes(url.pathname) || url.pathname.startsWith('/static/'))
        ) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
