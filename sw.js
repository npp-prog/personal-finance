/* Offline cache for the app shell. Bump VERSION whenever app files change. */
const VERSION = 'pundo-v1';
const SHELL = [
  './', './index.html', './css/styles.css', './js/ledger.js', './js/app.js',
  './manifest.webmanifest', './assets/favicon.png', './assets/logo-mark.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates show up), falling back to the cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request)
    .then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(event.request, copy));
      return res;
    })
    .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html'))));
});
