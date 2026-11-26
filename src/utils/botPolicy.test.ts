import { describe, it, expect } from 'vitest';
import { shouldBlockBot } from './botPolicy';

// User agents taken from Netlify request logs, Nov 2026.
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  twitter: 'Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  reddit: 'Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)',
  seranking: 'Mozilla/5.0 (compatible; SERankingBacklinksBot/1.0; +https://seranking.com/backlinks-crawler)',
  shapbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0',
  unknownBot: 'Mozilla/5.0 (compatible; BrandNewSeoCrawler/1.0; +https://example.com/bot)',
  headless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  python: 'python-requests/2.31.0',
};

const page = (ua: string | null, path = '/games/hollow-knight') => shouldBlockBot(ua, 'GET', path);

describe('shouldBlockBot', () => {
  it('lets browsers through', () => {
    expect(page(UA.chrome)).toBe(false);
    expect(page(UA.safari)).toBe(false);
  });

  it('lets search engines and link previews through', () => {
    for (const ua of [UA.googlebot, UA.bingbot, UA.applebot, UA.discord, UA.twitter, UA.facebook, UA.reddit]) {
      expect(page(ua)).toBe(false);
    }
  });

  it('blocks named bad bots and bots nobody has listed yet', () => {
    for (const ua of [UA.seranking, UA.shapbot, UA.gptbot, UA.unknownBot, UA.headless, UA.python]) {
      expect(page(ua)).toBe(true);
    }
  });

  it('blocks requests with no user agent', () => {
    expect(page(null)).toBe(true);
    expect(page('')).toBe(true);
  });

  it('leaves feeds, sitemap, robots and OG images open to any bot', () => {
    for (const path of ['/rss.xml', '/sitemap.xml', '/robots.txt', '/og/reviews/abc.jpg']) {
      expect(page(UA.unknownBot, path)).toBe(false);
    }
  });

  it('still blocks named bad bots on those open paths', () => {
    expect(page(UA.seranking, '/rss.xml')).toBe(true);
  });

  it('never blocks API routes or writes for unknown clients', () => {
    expect(page(UA.python, '/api/updates/latest')).toBe(false);
    expect(shouldBlockBot(UA.python, 'POST', '/contact')).toBe(false);
  });
});
