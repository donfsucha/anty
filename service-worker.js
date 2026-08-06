const CACHE_NAME = 'dlogis-control-v3.2.2-mission-map-sync';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './design-tokens.css',
  './flow-sync.css',
  './stagebar-ux.css',
  './system-consistency.css',
  './data-quality.css',
  './modal-actions-fix.css',
  './drone-detail-ux.css',
  './asset-visuals.css',
  './preflight-verification.css',
  './operations-map.css',
  './inline-live-map.css',
  './map-resilience.css',
  './excel-report.css',
  './agency-report.css',
  './responsive-layout.css',
  './workspace-layout.css',
  './notification-lifecycle.css',
  './mission-repeat.css',
  './core.js',
  './views.js',
  './app.js',
  './flow-sync-core.js',
  './stage-sequence-fix.js',
  './flow-sync-views.js',
  './stagebar-ux.js',
  './system-consistency.js',
  './data-quality.js',
  './precision-runtime.js',
  './view-alias-fix.js',
  './asset-visuals.js',
  './preflight-verification.js',
  './operations-map.js',
  './map-resilience.js',
  './inline-live-map.js',
  './flow-sync-events.js',
  './drone-detail-ux.js',
  './modal-actions-fix.js',
  './excel-report.js',
  './layout-optimizer.js',
  './report-observer-guard.js',
  './agency-report.js',
  './report-observer-release.js',
  './button-stability.js',
  './unified-report-mode.js',
  './stable-report-controls.js',
  './notification-lifecycle.js',
  './interaction-stability.js',
  './mission-repeat.js',
  './mission-map-sync.js',
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