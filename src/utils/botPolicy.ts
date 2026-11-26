import { isbot } from 'isbot';

/**
 * Which crawlers may render pages. Allowlist, not blocklist.
 *
 * Nov 2026: a blocklist only stops bots someone has already named, and two that
 * weren't on it (SERankingBacklinksBot, ShapBot) made up ~73% of all SSR
 * function runs before anyone noticed. Now any user agent `isbot()` recognises
 * as a bot is refused unless it matches GOOD_BOTS below, so the next new SEO or
 * AI crawler is turned away on its first request.
 *
 * What this can't catch: scrapers that pretend to be a normal browser (the
 * residential-proxy botnet earlier in Nov 2026). Those need edge protection
 * (Cloudflare in front of Netlify) — no user-agent rule will see them.
 *
 * Adding a bot: add a case-insensitive substring of its user agent to
 * GOOD_BOTS, with what it's for. Check Netlify's logs (top user agents by
 * function invocations, 403s) after a deploy for anything wanted that got
 * caught.
 */
const GOOD_BOTS = [
  // Search engines. "Google" covers Googlebot, Storebot-Google,
  // Google-InspectionTool (Search Console), FeedFetcher-Google, etc.
  'Google', 'bingbot', 'BingPreview', 'msnbot', 'Applebot', 'DuckDuckBot',
  'YandexBot', 'YandexImages', 'Baiduspider', 'Qwantbot', 'SeznamBot',
  // Link previews — these power the OG cards when someone shares a link.
  'Twitterbot', 'facebookexternalhit', 'Facebot', 'meta-externalfetcher',
  'Discordbot', 'Slackbot', 'Slack-ImgProxy', 'redditbot', 'LinkedInBot',
  'TelegramBot', 'WhatsApp', 'SkypeUriPreview', 'Pinterestbot', 'Mastodon',
  'Bluesky', 'Embedly', 'Iframely', 'vkShare', 'Snapchat',
  // AI assistants fetching a page because a person asked about it, and the
  // AI search indexes that cite and link back. Bulk training crawlers
  // (GPTBot, ClaudeBot, CCBot…) are not here and stay blocked.
  'ChatGPT-User', 'OAI-SearchBot', 'Claude-User', 'Claude-SearchBot', 'Perplexity-User',
];

/** Blocked even when it might look like a good bot above, e.g. a scanner
 *  whose UA happens to contain "Google". Also the vuln scanners and site
 *  rippers `isbot` doesn't always know. Kept in sync with robots.txt.ts. */
const BAD_BOTS = [
  // AI training / bulk scrapers
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'CCBot',
  'Bytespider', 'PerplexityBot', 'Amazonbot', 'meta-externalagent',
  'Diffbot', 'Omgilibot', 'ImagesiftBot', 'DataForSeoBot',
  // SEO/backlink scrapers
  'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot',
  'MegaIndex', 'SeekportBot', 'OpenLinkProfiler', 'SerpstatBot', 'PetalBot',
  'SERankingBacklinksBot', 'ShapBot', 'KeenableBot',
  // Vulnerability scanners
  'nikto', 'sqlmap', 'acunetix', 'nessus', 'zgrab', 'masscan',
  'wpscan', 'dirbuster', 'gobuster', 'ZmEu', 'Nmap',
  // Aggressive site rippers
  'HTTrack', 'SiteSucker', 'WebCopier', 'WebReaper',
];

function substringRegex(list: string[]): RegExp {
  return new RegExp(list.map((p) => p.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|'), 'i');
}

const GOOD_BOT_RE = substringRegex(GOOD_BOTS);
const BAD_BOT_RE = substringRegex(BAD_BOTS);

/** Machine-readable files any bot may fetch: feed readers (Feedly, Inoreader,
 *  directory submissions) read the RSS feed, crawlers need robots/sitemap, and
 *  preview services we haven't listed can still fetch the OG image. All are
 *  CDN-cached for a day or more, so they rarely cost a function run. */
const OPEN_TO_ALL_BOTS = /^\/(?:robots\.txt|sitemap\.xml|rss\.xml|og\/)/;

/** `true` when the request should get a 403 before any rendering. */
export function shouldBlockBot(userAgent: string | null, method: string, pathname: string): boolean {
  const ua = userAgent ?? '';
  if (ua && BAD_BOT_RE.test(ua)) return true;

  // Only page and file reads. API routes (POSTs, webhooks, our own fetches)
  // keep their own auth and are disallowed in robots.txt already; leaving them
  // out means a client library's user agent can never break a write.
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;
  if (OPEN_TO_ALL_BOTS.test(pathname)) return false;

  // No user agent at all is a script, not a browser.
  if (!ua) return true;
  return isbot(ua) && !GOOD_BOT_RE.test(ua);
}
