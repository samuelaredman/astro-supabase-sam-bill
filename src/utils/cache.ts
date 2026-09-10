/**
 * Netlify CDN cache headers.
 *
 * `durable` stores responses in Netlify's shared Durable Cache rather than only
 * on the edge node that served the miss. Without it every edge node keeps its
 * own copy, so at our traffic most anonymous requests land on a node that has
 * never seen the page and pay a full function render (~0.6–1.1 s vs ~90 ms for
 * a hit). Responses carrying this also need `Netlify-Vary` where the render
 * depends on the request — see `setPageCacheHeaders`.
 */
export function cdnCacheControl(maxAge: number, staleWhileRevalidate: number): string {
  return `public, durable, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

// @supabase/ssr stores the session in this cookie — or, once the encoded
// session passes 3180 chars, splits it into `<name>.0`, `<name>.1`, ... and
// drops the bare name. Varying on the bare name alone put chunked (logged-in)
// users on the same cache key as anonymous visitors, so they were served the
// cached logged-out page. Every chunked session has a `.0`.
const AUTH_COOKIE = 'sb-bzlwwtatoiyzwirerify-auth-token';
export const AUTH_VARY = `cookie=${AUTH_COOKIE}|${AUTH_COOKIE}.0`;

/**
 * Cache headers for SSR pages whose anonymous render is shareable. Logged-in
 * renders are personalized and never shared-cached; the browser never caches
 * either (`no-store`), so auth state changes show on the next navigation.
 */
export function setPageCacheHeaders(headers: Headers, isLoggedIn: boolean, maxAge = 300): void {
  if (!isLoggedIn) {
    headers.set('Netlify-CDN-Cache-Control', cdnCacheControl(maxAge, 600));
    headers.set('Cache-Control', 'no-store');
  } else {
    headers.set('Cache-Control', 'private, no-store');
  }
  headers.set('Netlify-Vary', AUTH_VARY);
}
