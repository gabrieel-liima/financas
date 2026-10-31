// Service worker: guarda os arquivos do app no iPhone para funcionar offline.
// Ao publicar uma nova versão do app, aumente o número abaixo (v1 -> v2).
const CACHE = 'financas-v1';

const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/calc.js',
  './js/db.js',
  './js/format.js',
  './js/xlsx.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
