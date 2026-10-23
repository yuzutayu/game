// GitHub Pages のサブディレクトリで動作するデイリーボード用 Service Worker
// アイコンなどを置き換えた後、修正時は v3 を v4 などに変更してください。
const CACHE_NAME = 'daily-board-pwa-v3';
const CORE_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name.startsWith('daily-board-pwa-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// ネットに接続できるときは常に最新版を優先し、オフライン時のみ保存済みファイルを使用。
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    } catch (_) {
      const saved = await cache.match(req);
      if (saved) return saved;
      if (req.mode === 'navigate') {
        const fallback = await cache.match(new URL('./index.html', self.registration.scope));
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
