// Service Worker for PWA

const CACHE_NAME = 'guanyin-fortune-cache-v3';
// List of files to cache.
const urlsToCache = [
  '/',
  'index.html',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/lunar-javascript@1.7.8/lunar.min.js',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&display=swap',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png'
];

// Install a service worker
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache).catch(err => console.warn('部分檔案快取失敗', err));
      })
  );
});

// 網路優先：有網路時永遠拿最新版本，離線時才用快取
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Update a service worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
