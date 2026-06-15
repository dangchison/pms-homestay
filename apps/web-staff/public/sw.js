/*
 * Service worker PWA web-staff (task 6.6, docs/13 §4, ui/02 §PWA).
 * Chiến lược kiểu Workbox, viết tay (không phụ thuộc runtime CDN — hoạt động cả
 * khi offline):
 *   - PRECACHE app shell (các route tĩnh + manifest + icon) lúc install.
 *   - NAVIGATION (mở trang): network-first → cache → fallback /offline.
 *   - STATIC (_next/static, icons): cache-first (bất biến theo hash).
 *   - API GET danh sách (today/rooms-board/cleaning-tasks): stale-while-revalidate
 *     (xem được dữ liệu đã tải khi rớt mạng). KHÔNG cache PII đầy đủ — chỉ list.
 *   - ★ READ-CACHE ONLY: KHÔNG đụng tới mutation (POST/PATCH/PUT/DELETE) — chúng
 *     yêu cầu mạng; UI tự disable + OfflineBanner (không có offline write queue).
 */
const VERSION = 'v1';
const SHELL_CACHE = `pms-staff-shell-${VERSION}`;
const STATIC_CACHE = `pms-staff-static-${VERSION}`;
const API_CACHE = `pms-staff-api-${VERSION}`;
const OFFLINE_URL = '/offline';

const SHELL_URLS = [
  '/login',
  '/today',
  '/cleaning',
  '/rooms',
  '/profile',
  OFFLINE_URL,
  '/manifest.json',
  '/icons/icon.svg',
];

// API GET được phép cache (chỉ list/board đã mask — KHÔNG cache giấy tờ/PII đầy đủ).
const CACHEABLE_API = ['/api/v1/bookings/today', '/api/v1/rooms/board', '/api/v1/cleaning-tasks'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache từng URL riêng để 1 lỗi không làm hỏng toàn bộ install.
      await Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

function isCacheableApi(url) {
  return CACHEABLE_API.some((p) => url.pathname.startsWith(p));
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || new Response('{"error":{"code":"OFFLINE"}}', {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // read-cache only — bỏ qua mutation

  const url = new URL(request.url);

  // Mở trang (điều hướng): network-first, fallback cache rồi /offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const shell = await caches.open(SHELL_CACHE);
          return (await shell.match(request)) || (await shell.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Tài nguyên tĩnh Next (bất biến theo hash) + icon: cache-first.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons'))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      })(),
    );
    return;
  }

  // API GET danh sách: stale-while-revalidate.
  if (isCacheableApi(url)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
  }
});
