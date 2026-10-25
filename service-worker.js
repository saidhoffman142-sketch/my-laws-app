// ============================================================
//  АИПС «РПА» — Service Worker
//  Меняйте BUILD при каждом релизе index.html / ассетов.
//  Это единственное место, где нужно править версию.
// ============================================================

const BUILD = 'AIPS-RPA-v1';
const CACHE_NAME = `pravo-rpa-${BUILD}`;
const OFFLINE_URL = './offline.html';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './sql-wasm.js',
  './sql-wasm.wasm',
  OFFLINE_URL
  // laws.db.* НЕ кэшируем — база хранится в IndexedDB
];

// ---------- install ----------
self.addEventListener('install', (event) => {
  // Активируемся сразу, не ждём закрытия старых вкладок
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] Не закэшировано:', url, err);
          })
        )
      )
    )
  );
});

// ---------- activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Удаляем все кэши, кроме текущего
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null))
      );

      // Включаем navigation preload, если поддерживается (ускоряет навигацию)
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }

      await self.clients.claim();
    })()
  );
});

// ---------- message ----------
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', build: BUILD, cache: CACHE_NAME });
  }
});

// ---------- helpers ----------
function isNavigation(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isDatabaseRequest(url) {
  // laws.db, laws.db.001 … laws.db.NNN
  return /\/laws\.db(\.\d+)?$/.test(url.pathname);
}

function isHtmlRequest(url) {
  return url.pathname.endsWith('/') || url.pathname.endsWith('.html');
}

// ---------- fetch ----------
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Только GET; остальное — как есть
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Внешние домены (например, pravo.gov.ru) не трогаем
  if (url.origin !== self.location.origin) return;

  // Базу данных не перехватываем — пусть идёт нативный fetch
  if (isDatabaseRequest(url)) return;

  // ---- HTML и навигация: network-first с fallback в кэш ----
  if (isNavigation(request) || isHtmlRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          // Используем navigation preload, если доступен
          const preload = await event.preloadResponse;
          if (preload) {
            // Обновляем кэш свежим HTML
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, preload.clone()).catch(() => {});
            return preload;
          }

          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          // Офлайн — отдаём кэш, иначе offline.html
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  // ---- Остальное: cache-first с фоновым обновлением ----
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        // Тихо обновляем кэш в фоне (stale-while-revalidate)
        fetch(request)
          .then(async (response) => {
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              cache.put(request, response.clone()).catch(() => {});
            }
          })
          .catch(() => {});
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        // Для картинок/иконок — отдаём прозрачный пиксель, чтобы не ломать вёрстку
        if (request.destination === 'image') {
          return new Response(
            Uint8Array.from([
              0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,
              0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
              0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,0x89,0x00,0x00,0x00,
              0x0d,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0x00,0x01,0x00,0x00,
              0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,0x00,0x00,0x00,0x49,
              0x45,0x4e,0x44,0xae,0x42,0x60,0x82
            ]),
            { status: 200, headers: { 'Content-Type': 'image/png' } }
          );
        }
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })()
  );
});