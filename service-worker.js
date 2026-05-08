const CACHE_NAME = 'dorameiros-v2';
const STATIC = [
  '/dorameiros/',
  '/dorameiros/index.html',
  '/dorameiros/login.html',
  '/dorameiros/style.css',
  '/dorameiros/app.js',
  '/dorameiros/auth.js',
  '/dorameiros/firebase-config.js',
  '/dorameiros/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
