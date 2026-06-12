/* sw.js — 오프라인 지원 서비스 워커 */
const CACHE = 'modu-todo-v2';
const ASSETS = [
  './index.html',
  './css/style.css',
  './js/sync.js',
  './js/store.js',
  './js/nlp.js',
  './js/ics.js',
  './js/calendar.js',
  './js/gcal.js',
  './js/app.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 네트워크 우선, 실패 시 캐시 (구글 API 요청은 그대로 통과) */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
