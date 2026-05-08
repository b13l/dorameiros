const CACHE_NAME = 'dorameiros-v3';
const STATIC = [
  '/',
  '/index.html',
  '/login.html',
  '/style.css',
  '/app.js',
  '/auth.js',
  '/firebase-config.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
