import { defineMiddleware } from 'astro:middleware';
import { rewriteImageUrls } from './utils/imageCdn';

// User-agent substrings for crawlers and scanners that either ignore robots.txt
// or should never have been hitting us in the first place. Match is
// case-insensitive substring — the SEO/AI entries intentionally duplicate names
// already in robots.txt (src/pages/robots.txt.ts): well-behaved versions obey
// robots.txt and never reach middleware; badly-behaved versions ignore it and
// are caught here. The vuln-scanner entries have no legitimate reason to
// reach us at all — they're probing for exposed creds / known CVEs.
//
// Short-circuiting here still costs one Netlify function invocation per blocked
// request, but exits in <5ms (no DB, no SSR render) vs ~600-1000ms for a real
// render — the compute-credit line item (the biggest cost) drops accordingly.
// Full edge-level blocking would require Cloudflare or a Netlify Edge Function.
const BLOCKED_UA_PATTERNS = [
  // AI training / bulk scrapers
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'CCBot',
  'Bytespider', 'PerplexityBot', 'Amazonbot', 'meta-externalagent',
  'Diffbot', 'Omgilibot', 'ImagesiftBot', 'DataForSeoBot',
  // SEO/backlink scrapers
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot',
  'MegaIndex', 'SeekportBot', 'OpenLinkProfiler', 'SerpstatBot', 'PetalBot',
  // Vulnerability scanners
  'nikto', 'sqlmap', 'acunetix', 'nessus', 'zgrab', 'masscan',
  'wpscan', 'dirbuster', 'gobuster', 'ZmEu', 'Nmap',
  // Aggressive site rippers
  'HTTrack', 'SiteSucker', 'WebCopier', 'WebReaper',
];

const BLOCKED_UA_RE = new RegExp(
  BLOCKED_UA_PATTERNS.map((p) => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|'),
  'i',
);

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

export const onRequest = defineMiddleware(async (context, next) => {
  // Short-circuit known-bad crawlers before any SSR work runs. See the
  // BLOCKED_UA_PATTERNS block above for the policy.
  //
  // Skip for prerendered routes: at build time there's no real request, and
  // in production those routes are served statically from the CDN without
  // hitting the SSR function — no function cost to save, nothing to block.
  // Accessing headers during prerender also triggers an Astro build warning.
  if (!context.isPrerendered) {
    const ua = context.request.headers.get('user-agent') ?? '';
    if (ua && BLOCKED_UA_RE.test(ua)) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

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
