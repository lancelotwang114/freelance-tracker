// 外包收益管理工具 — Service Worker
// 策略：app shell（HTML/CSS/JS）走 Cache-First，雲端 API 一律走 Network-Only
// 升 CACHE_VERSION 會讓使用者下次開頁時自動取得新版

const CACHE_VERSION = 'ftracker-v2.10.15';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// v2.10.10: 收到 SKIP_WAITING 訊息就立刻取代舊 SW，避免「點此更新」沒反應
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 雲端 API（Apps Script、ipapi、bigdatacloud 等外部）→ Network-Only，不快取
  const isExternalApi =
    url.host.includes('script.google.com') ||
    url.host.includes('googleusercontent.com') ||
    url.host.includes('ipapi.co') ||
    url.host.includes('bigdatacloud.net');

  if (isExternalApi) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ ok: false, error: 'offline' }), { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // 同源資源：Cache-First，失敗回 network
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          // 順便把成功取得的 GET 加進 cache（漸進式快取）
          if (event.request.method === 'GET' && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return resp;
        });
      })
    );
  }
});
