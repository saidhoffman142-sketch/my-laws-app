const CACHE_NAME = 'pravo-sql-v7'; // Версию подняли, чтобы сбросить старый кэш
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './sql-wasm.js',
  './sql-wasm.wasm',
  './offline.html',
  './laws.db.001', // <--- Добавили части базы
  './laws.db.002',
  './laws.db.003',
  './laws.db.004',
  './laws.db.005'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map(url => cache.add(url).catch(err => console.warn('Не закэшировано:', url)))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./offline.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});