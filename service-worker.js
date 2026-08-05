const CACHE_NAME = 'dlogis-control-v2.2.3-explicit-modal-close';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './flow-sync.css',
  './stagebar-ux.css',
  './modal-actions-fix.css',
  './core.js',
  './views.js',
  './app.js',
  './flow-sync-core.js',
  './stage-sequence-fix.js',
  './flow-sync-views.js',
  './stagebar-ux.js',
  './flow-sync-events.js',
  './modal-actions-fix.js',
  './manifest.webmanifest',
  './app-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});