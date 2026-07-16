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
// SECURITY: never hardcode the Supabase project URL here — it is the value of
// the SUPABASE_DATABASE_URL env var, and Netlify's secret scanner fails the
// build if an env-var value appears in committed code. The host is read from
// the environment at runtime instead. Any host that ends up in the list below
// MUST also be covered by the `remote_images` allowlist in netlify.toml (which
// uses a project-agnostic *.supabase.co wildcard for the same reason).

// IGDB is a fixed public host (not an env value), so it may be named directly.
const IGDB_HOST = 'images.igdb.com';

/** The Supabase Storage host, derived from env — never hardcoded. */
export function supabaseHostFromEnv(): string | null {
  const url =
    import.meta.env.SUPABASE_DATABASE_URL ??
    (typeof process !== 'undefined' ? process.env.SUPABASE_DATABASE_URL : undefined);
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Hosts whose images are routed through the Netlify Image CDN. */
export function cdnHosts(): string[] {
  const hosts = [IGDB_HOST];
  const supabase = supabaseHostFromEnv();
  if (supabase) hosts.push(supabase);
  return hosts;
}

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
 *
 * `hosts` defaults to the runtime allowlist; tests pass an explicit list so no
 * real project URL is ever embedded in the repo.
 */
export function rewriteImageUrls(html: string, hosts: string[] = cdnHosts()): string {
  if (hosts.length === 0) return html;
  const hostAlt = hosts.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // Anchoring on `src=` keeps us clear of <meta ... content="…"> (og:image),
  // <link href>, canonical URLs, and JSON-LD, which must keep the original
  // absolute URL for scrapers/RSS.
  const srcRe = new RegExp(`(\\ssrc=)(["'])(https://(?:${hostAlt})/[^"']+)\\2`, 'g');
  // The same URL used as a CSS background, e.g. style="background-image:url(…)".
  const cssUrlRe = new RegExp(`url\\((['"]?)(https://(?:${hostAlt})/[^)'"]+)\\1\\)`, 'g');

  return html
    .replace(srcRe, (_m, pre, quote, url) => `${pre}${quote}${toCdnUrl(url)}${quote}`)
    .replace(cssUrlRe, (_m, quote, url) => `url(${quote}${toCdnUrl(url)}${quote})`);
}
