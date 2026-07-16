// Netlify Image CDN routing.
//
// We do NOT rewrite <img> tags at the call site (181 of them across 37 files).
// Instead the middleware (src/middleware.ts) runs the outgoing HTML through
// `rewriteImageUrls`, which swaps ONLY the URL string inside `src="…"` and CSS
// `url(…)` for a Netlify Image CDN URL. Nothing else about the markup changes —
// no classes, dimensions, positioning, or surrounding tags — so the swap is
// visually seamless.
//
// Netlify optimizes and, when no format is forced, content-negotiates a modern
// format (AVIF/WebP) from the browser's Accept header while preserving the
// source's pixel dimensions. That's the bandwidth win with no risk of blur or
// layout shift.
//
// Any host listed here MUST also be present in the `remote_images` allowlist in
// netlify.toml, or the CDN will refuse to transform it. Hosts not listed here
// simply pass through unchanged (served as the original URL) — never broken.

export const CDN_HOSTS = [
  'images.igdb.com',              // game covers, developer logos, platform art
  'bzlwwtatoiyzwirerify.supabase.co', // Supabase Storage: avatars + banners
] as const;

const HOST_ALT = CDN_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|');

// A URL on one of our hosts, used as an <img src>. Anchoring on `src=` keeps us
// clear of <meta ... content="…"> (og:image), <link href>, canonical URLs, and
// JSON-LD, which must keep the original absolute URL for scrapers/RSS.
const SRC_RE = new RegExp(`(\\ssrc=)(["'])(https://(?:${HOST_ALT})/[^"']+)\\2`, 'g');

// The same URL used as a CSS background, e.g. style="background-image:url(…)".
const CSS_URL_RE = new RegExp(`url\\((['"]?)(https://(?:${HOST_ALT})/[^)'"]+)\\1\\)`, 'g');

/** Wrap a raw source URL in a Netlify Image CDN request. */
export function toCdnUrl(raw: string): string {
  // Attribute values may arrive HTML-escaped (& → &amp;); undo that before
  // encoding so the CDN receives the true source URL.
  const clean = raw.replace(/&amp;/g, '&');
  return `/.netlify/images?url=${encodeURIComponent(clean)}`;
}

/**
 * Rewrite every allowlisted remote image URL in an HTML string to its Netlify
 * Image CDN equivalent. Pure and idempotent-safe on our output (source HTML
 * never contains `/.netlify/images`). Only `src=` and CSS `url(…)` values are
 * touched; all other markup is returned byte-for-byte unchanged.
 */
export function rewriteImageUrls(html: string): string {
  return html
    .replace(SRC_RE, (_m, pre, quote, url) => `${pre}${quote}${toCdnUrl(url)}${quote}`)
    .replace(CSS_URL_RE, (_m, quote, url) => `url(${quote}${toCdnUrl(url)}${quote})`);
}
