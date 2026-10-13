import { defineMiddleware } from 'astro:middleware';
import { rewriteImageUrls } from './utils/imageCdn';

// The previous implementation buffered the entire HTML body with
// `await response.text()` before shipping any bytes. That disabled Astro's
// streaming SSR site-wide: TTFB waited for the full render on every page.
//
// Now the rewrite runs through a TransformStream that holds back only enough
// trailing bytes to cover any in-progress `src="..."` / `url(...)` value, and
// pipes everything else through to the client immediately. The <head> and the
// top of the body reach the browser as soon as the renderer produces them.
//
// MAX_URL_TAIL is the longest matchable attribute value we expect. Any complete
// `src="..."` or `url(...)` is shorter than this, so once we're past that many
// bytes from the last potential opener, nothing further can straddle the flush
// boundary.
const MAX_URL_TAIL = 2048;

/**
 * Position up to which `s` is safe to emit without splitting a match.
 * Looks for the last potential opener (` src=` or `url(`) and, if it is close
 * to the end, holds back from it. Otherwise everything is flushable.
 */
function safeSplit(s: string): number {
  const lastSrc = s.lastIndexOf(' src=');
  const lastUrl = s.lastIndexOf('url(');
  const lastOpen = lastSrc > lastUrl ? lastSrc : lastUrl;
  if (lastOpen < 0) return s.length;
  if (s.length - lastOpen >= MAX_URL_TAIL) return s.length;
  return lastOpen;
}

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  // The Netlify Image CDN endpoint (/.netlify/images) only exists on Netlify
  // deploys, not under `astro dev` — leave URLs as-is locally so images load.
  if (import.meta.env.DEV) return response;

  // Only server-rendered HTML. Skips /og/*.jpg, /rss.xml, and /api/* JSON,
  // whose content-types aren't text/html — protecting og:image/RSS absolute URLs.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const split = safeSplit(pending);
      if (split > 0) {
        controller.enqueue(encoder.encode(rewriteImageUrls(pending.slice(0, split))));
        pending = pending.slice(split);
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.length > 0) {
        controller.enqueue(encoder.encode(rewriteImageUrls(pending)));
        pending = '';
      }
    },
  });

  // Rebuild the response, preserving status and headers (incl. Set-Cookie for
  // auth). Body length is unknown while streaming, so drop Content-Length.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
