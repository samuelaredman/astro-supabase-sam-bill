// Chekpoint service worker — v1
// Strategy: network-first for navigation (SSR pages always fresh),
// cache-first for static assets (fonts, images, etc.)

const CACHE = 'chekpoint-v1';
const PRECACHE = ['/favicon.svg', '/manifest.json'];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  // Always go to network for page navigations — we're SSR, pages must be fresh
  if (e.request.mode === 'navigate') return;

  // For API routes, always network — never cache
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Static assets: try cache first, fall back to network and cache the result
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(res) {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        var clone = res.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return res;
      });
    })
  );
});
