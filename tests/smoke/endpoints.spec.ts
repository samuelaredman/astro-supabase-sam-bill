import { test, expect } from '@playwright/test';
import { getSamples } from './helpers';

// Machine-readable routes: feeds, sitemap, OG images, public read APIs.

test('rss.xml is a valid RSS feed with items', async ({ request }) => {
  const res = await request.get('/rss.xml');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('xml');
  const body = await res.text();
  expect(body).toContain('<rss');
  expect(body).toContain('<item>');
});

test('sitemap.xml lists URLs', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/<(urlset|sitemapindex)/);
  expect(body).toContain('<loc>');
});

test('robots.txt points at the sitemap', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/Sitemap:/i);
});

// Function-cost guards (Nov 2026): ?tab= variants and the two crawlers that
// made up ~73% of SSR invocations must stay out.
test('robots.txt keeps crawlers off ?tab= variants and blocks cost-heavy bots', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  expect(body).toContain('Disallow: /*?tab=');
  for (const bot of ['SERankingBacklinksBot', 'ShapBot']) {
    expect(body).toMatch(new RegExp(`User-agent: ${bot}\\nDisallow: /\\n`));
  }
});

test('blocked crawlers get a 403 without a page render', async ({ request }) => {
  const res = await request.get('/rankings', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; SERankingBacklinksBot/1.0; +https://seranking.com/backlinks-crawler)' },
  });
  expect(res.status()).toBe(403);
});

test('unlisted crawlers are refused but search engines still get pages', async ({ request }) => {
  const unknown = await request.get('/rankings', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; BrandNewSeoCrawler/1.0; +https://example.com/bot)' },
  });
  expect(unknown.status()).toBe(403);
  const google = await request.get('/rankings', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  });
  expect(google.status()).toBe(200);
});

test('home OG image renders', async ({ request }) => {
  const res = await request.get('/og/home.jpg');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/jpeg');
  expect((await res.body()).length).toBeGreaterThan(5_000);
});

test('profile and review OG images render', async ({ request }) => {
  const s = await getSamples(request);
  const username = s.reviewer.split('/').pop();
  const reviewId = s.review.split('/').pop();
  for (const path of [`/og/profiles/${username}.jpg`, `/og/reviews/${reviewId}.jpg`]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toContain('image/jpeg');
  }
});

test('game search API returns ranked games', async ({ request }) => {
  const res = await request.get('/api/games/search?q=zelda');
  expect(res.status()).toBe(200);
  const body = await res.json();
  const games = Array.isArray(body) ? body : body.games ?? body.results ?? body.data;
  expect(Array.isArray(games), `unexpected shape: ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
  expect(games.length).toBeGreaterThan(0);
  expect(JSON.stringify(games[0]).toLowerCase()).toContain('zelda');
});
