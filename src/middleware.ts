import { defineMiddleware } from 'astro:middleware';
import { rewriteImageUrls } from './utils/imageCdn';

// Routes remote images through the Netlify Image CDN by rewriting the outgoing
// HTML. See src/utils/imageCdn.ts for the why and the exact scope of the swap.
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  // The Netlify Image CDN endpoint (/.netlify/images) only exists on Netlify
  // deploys, not under `astro dev` — leave URLs as-is locally so images load.
  if (import.meta.env.DEV) return response;

  // Only server-rendered HTML. Skips /og/*.jpg, /rss.xml, and /api/* JSON,
  // whose content-types aren't text/html — protecting og:image/RSS absolute URLs.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  const rewritten = rewriteImageUrls(html);
  if (rewritten === html) return response;

  // Rebuild the response, preserving status and headers (incl. Set-Cookie for
  // auth). Body length changed, so drop the now-stale Content-Length.
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
