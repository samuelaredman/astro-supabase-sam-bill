import type { APIRoute } from 'astro';

// robots.txt is served dynamically so it can differ by host:
//  • the real domain (and anything that isn't a Netlify preview) gets the full
//    production ruleset below;
//  • *.netlify.app deploy-preview / branch-deploy hosts get a blanket
//    Disallow so crawlers stop spending bandwidth on throwaway preview URLs
//    (Netlify posts those URLs publicly on GitHub PRs, so bots find them).
//
// Fail-safe by design: only an explicit `.netlify.app` host is treated as a
// preview. If host detection is ever wrong, the real site still gets its normal
// robots — never an accidental site-wide Disallow that would deindex us.
export const prerender = false;

// Public content (games, reviewers, reviews, recommendations, lists, groups,
// genres, platforms, studios) is crawlable by search + link-preview bots.
// Per-user content is only *indexed* when its author opts in (settings → search
// engine visibility); non-consented pages carry <meta name="robots"
// content="noindex"> so crawlers may fetch but won't index them.
//
// The AI-scraper block list below is deliberately narrow: it names only
// training/bulk-scraping crawlers that cost bandwidth without sending traffic.
// Googlebot, Bingbot, and every link-preview crawler (Discordbot, Twitterbot,
// facebookexternalhit, Slackbot, redditbot, LinkedInBot, Telegram, etc.) are
// intentionally NOT listed — they stay under `User-agent: *` and keep working,
// which is what powers our OG share previews.
const PRODUCTION_ROBOTS = `User-agent: *
Allow: /

# Functional / authenticated-only pages — no SEO value, keep out of the index.
# og:image endpoints (satori/resvg-rendered share-preview images for profiles,
# reviews, lists, and the homepage) intentionally live at /og/, not /api/og/ —
# some link-preview crawlers (Reddit's included) only support the Disallow
# directive and silently ignore Allow overrides, so an /api/ disallow with an
# /api/og/ allow carve-out isn't reliably honored. Keeping the image routes
# out of /api/ entirely sidesteps that ambiguity rather than depending on it.
Disallow: /api/
Disallow: /admin
Disallow: /auth/
Disallow: /settings
Disallow: /notifications
Disallow: /profile
Disallow: /following
Disallow: /welcome
Disallow: /signin
Disallow: /signup
Disallow: /forgot-password
Disallow: /reset-password-confirm

# ── AI training / bulk-scraping crawlers ────────────────────────────────────
# These pull full-site sweeps (every page, every image) and were behind the
# single-day bandwidth spikes. They send little or no referral traffic, so we
# opt out. Note: the "-Extended" agents govern ONLY AI-training use and do not
# affect normal Google/Apple search indexing, so blocking them is SEO-safe.
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Amazonbot
Disallow: /

User-agent: meta-externalagent
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Diffbot
Disallow: /

User-agent: Omgilibot
Disallow: /

User-agent: ImagesiftBot
Disallow: /

User-agent: DataForSeoBot
Disallow: /

Sitemap: https://chekpoint.gg/sitemap.xml
`;

const PREVIEW_ROBOTS = `# Non-production deploy (Netlify preview / branch deploy).
# Keep all bots out so throwaway preview URLs don't burn bandwidth or leak
# into search results.
User-agent: *
Disallow: /
`;

export const GET: APIRoute = (context) => {
  const isPreviewHost = context.url.host.endsWith('.netlify.app');
  const body = isPreviewHost ? PREVIEW_ROBOTS : PRODUCTION_ROBOTS;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Cheap to regenerate, but no reason to; cache hard at the edge.
      'Cache-Control': 'public, max-age=3600',
      'Netlify-CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};
