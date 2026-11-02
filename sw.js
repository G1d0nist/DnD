'use strict';
// Увеличивайте версию при изменении файлов, чтобы обновить кэш у пользователей.
const CACHE = 'dnd55-v24';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'data2.js', 'table.js', 'sync.js', 'firebase-config.js', 'manifest.webmanifest', 'icon.svg'];
// Кроме своих файлов кэшируем только шрифты и SDK Firebase; запросы к базе Firestore и входу не трогаем.
const CACHE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Сначала сеть (свежие файлы), при её отсутствии — кэш.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !CACHE_HOSTS.includes(url.hostname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
