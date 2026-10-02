// Chekpoint service worker — v2
// Strategy: cache-first ONLY for known-immutable static assets. Every other
// request (including SSR HTML — pages AND on-demand tab fragments fetched by
// the profile page's tab loader) passes through to the network, so counts,
// reviews, and library data are always fresh.
//
// v1 treated any non-/api/ GET as cacheable, which meant fragments like
// /reviewers/<user>/tab/library got cached indefinitely on first fetch. The
// tab loader in reviewers/[username].astro uses fetch() (request.mode='cors',
// not 'navigate'), so the "bypass for navigations" clause didn't cover it,
// and users saw stale library counts until they hard-refreshed. Bumping the
// cache name also purges those stale entries on the next visit.

const CACHE = 'chekpoint-v2';
const PRECACHE = ['/favicon.svg', '/manifest.json'];

// Only cache what's genuinely immutable:
//   - Astro's content-hashed bundles under /_astro/
//   - Font/image/CSS/JS by extension (covers /public/ static files)
// Anything else — including HTML — is dynamic and must reach the network.
function isCacheableStatic(url) {
  if (url.pathname.startsWith('/_astro/')) return true;
  return /\.(css|js|mjs|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|eot)$/i.test(url.pathname);
}

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

  var url = new URL(e.request.url);

  // Same-origin static assets only — pass everything else (HTML pages, tab
  // fragments, /api/, cross-origin) straight through to the network.
  if (url.origin !== self.location.origin) return;
  if (!isCacheableStatic(url)) return;

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
