/**
 * Netlify CDN cache headers.
 *
 * `durable` stores responses in Netlify's shared Durable Cache rather than only
 * on the edge node that served the miss. Without it every edge node keeps its
 * own copy, so at our traffic most anonymous requests land on a node that has
 * never seen the page and pay a full function render (~0.6–1.1 s vs ~90 ms for
 * a hit).
 *
 * The Durable Cache keys on the path alone unless told otherwise — without
 * `Netlify-Vary: query`, /search?q=mario was served the cached /search?q=zelda
 * page and /api/feed/recent?cursor=… returned page one for every cursor. Every
 * durable response must therefore vary on the query string.
 */
function cdnCacheControl(maxAge: number, staleWhileRevalidate: number): string {
  return `public, durable, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

/** CDN cache headers for responses that are the same for every visitor.
 *
 * `tags` attaches `Netlify-Cache-Tag` so the response can be purged on demand
 * by `purgeCache({ tags })` — see `purgeReviewsPublicCache` below. Caller is
 * responsible for passing a tag that matches the `purgeCache` call it wants to
 * invalidate the response with. */
export function cdnCacheHeaders(maxAge: number, staleWhileRevalidate: number, tags?: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Netlify-CDN-Cache-Control': cdnCacheControl(maxAge, staleWhileRevalidate),
    'Netlify-Vary': 'query',
  };
  if (tags && tags.length) h['Netlify-Cache-Tag'] = tags.join(',');
  return h;
}

// @supabase/ssr stores the session in this cookie — or, once the encoded
// session passes 3180 chars, splits it into `<name>.0`, `<name>.1`, ... and
// drops the bare name. Varying on the bare name alone put chunked (logged-in)
// users on the same cache key as anonymous visitors, so they were served the
// cached logged-out page. Every chunked session has a `.0`.
const AUTH_COOKIE = 'sb-bzlwwtatoiyzwirerify-auth-token';
export const PAGE_VARY = `query,cookie=${AUTH_COOKIE}|${AUTH_COOKIE}.0`;

/**
 * Cache headers for SSR pages whose anonymous render is shareable. Logged-in
 * renders are personalized and never shared-cached; the browser never caches
 * either (`no-store`), so auth state changes show on the next navigation.
 *
 * Default anonymous TTL: 1 hour fresh + 1 day stale-while-revalidate. Chosen
 * to minimise Netlify function invocations from bot sweeps (every cache-hit
 * saves one full SSR render). During SWR, the edge serves the stale copy
 * immediately and schedules at most one background refresh per cache window,
 * so content never exceeds ~1 day stale for anon visitors. Callers that need
 * fresher content pass an explicit shorter `maxAge` (e.g. discussions 60-120s).
 */
export function setPageCacheHeaders(headers: Headers, isLoggedIn: boolean, maxAge = 3600, tags?: string[]): void {
  if (!isLoggedIn) {
    headers.set('Netlify-CDN-Cache-Control', cdnCacheControl(maxAge, 86400));
    headers.set('Cache-Control', 'no-store');
    // Tags are only meaningful on cacheable responses — logged-in branch is
    // private no-store, so a tag there would never be used by a purge anyway.
    if (tags && tags.length) headers.set('Netlify-Cache-Tag', tags.join(','));
  } else {
    headers.set('Cache-Control', 'private, no-store');
  }
  headers.set('Netlify-Vary', PAGE_VARY);
}

/** Tag constants for `purgeCache({ tags })`. One tag covers every anon-cached
 *  surface that renders review content; a review create/update/delete purges
 *  it and the next anon hit on any of those pages re-renders from DB. */
export const CACHE_TAG_REVIEWS_PUBLIC = 'reviews-public';

/** `/api/updates/latest` — every page view fetches it for the nav badge, so it
 *  is cached long and purged whenever a staff Updates post changes. */
export const CACHE_TAG_UPDATES = 'updates';

/** Purge every CDN response carrying any of `tags`. Non-throwing; logs and
 *  returns on failure so a mutation route doesn't fail if the purge API blips
 *  (or we're running outside Netlify in dev/tests — `@netlify/functions`'s
 *  purgeCache is a no-op there). */
export async function purgeCacheTags(tags: string[]): Promise<void> {
  try {
    const { purgeCache } = await import('@netlify/functions');
    await purgeCache({ tags });
  } catch (e) {
    console.error(`[cache] purge of ${tags.join(',')} failed (non-fatal):`, e);
  }
}

export function purgeReviewsPublicCache(): Promise<void> {
  return purgeCacheTags([CACHE_TAG_REVIEWS_PUBLIC]);
}
