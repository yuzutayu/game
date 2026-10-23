// GitHub Pages のサブディレクトリで動作するデイリーボード用 Service Worker
// アイコンなどを置き換えた後、修正時は v6 を v7 などに変更してください。
const CACHE_NAME = 'daily-board-pwa-v6';
const CORE_FILES = [
  './',
  './index.html',
  './push-client.js',
  './push-config.js',
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

// iPhoneのホーム画面PWAが閉じていても、サーバーからのPushを表示
self.addEventListener('push',event=>{
  let data = {};
  try { if (event.data) data = event.data.json(); } catch (_) {}
  const title = String(data.title || 'デイリーボード').slice(0,90);
  const options = {
    body: String(data.body || '日課を確認してください。').slice(0,220),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: String(data.tag || 'daily-board-reminder').slice(0,160),
    data: {url: new URL('./',self.registration.scope).href},
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const dest = new URL('./',self.registration.scope).href;
  event.waitUntil((async()=>{
    const windows = await clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(dest);
  })());
});
