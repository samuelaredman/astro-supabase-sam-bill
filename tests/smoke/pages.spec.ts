import { test, expect } from '@playwright/test';
import { watch, openPage, getSamples, type Samples } from './helpers';

// Every page a logged-out visitor can open renders: 200, the site nav, no
// JS exceptions, no failed requests to our own site.

const PUBLIC_PAGES = [
  '/',
  '/discover',
  '/rankings',
  '/search',
  '/search?q=zelda',
  '/recommendations',
  '/lists',
  '/updates',
  '/following',
  '/about',
  '/terms',
  '/privacy',
  '/signin',
  '/signup',
  '/forgot-password',
];

for (const path of PUBLIC_PAGES) {
  test(`public page ${path}`, async ({ page }) => {
    const health = watch(page);
    await openPage(page, path);
    await health.expectHealthy();
  });
}

// Dynamic pages, built from links found on the live site (see getSamples).
const DYNAMIC_PAGES: [string, (s: Samples) => string][] = [
  ['game', (s) => s.game],
  ['game ?tab=reviews', (s) => `${s.game}?tab=reviews`],
  ['game ?tab=stats', (s) => `${s.game}?tab=stats`],
  ['game ?tab=recommendations', (s) => `${s.game}?tab=recommendations`],
  ['reviewer profile', (s) => s.reviewer],
  ['reviewer ?tab=reviews', (s) => `${s.reviewer}?tab=reviews`],
  ['reviewer ?tab=library', (s) => `${s.reviewer}?tab=library`],
  ['reviewer ?tab=lists', (s) => `${s.reviewer}?tab=lists`],
  ['reviewer ?tab=recommendations', (s) => `${s.reviewer}?tab=recommendations`],
  ['reviewer ?tab=stats', (s) => `${s.reviewer}?tab=stats`],
  ['reviewer games', (s) => `${s.reviewer}/games`],
  ['review', (s) => s.review],
  ['list', (s) => s.list],
  ['recommendation', (s) => s.recommendation],
  ['update post', (s) => s.update],
  ['group overview', (s) => s.group],
  ['group ?tab=feed', (s) => `${s.group}?tab=feed`],
  ['group ?tab=compare', (s) => `${s.group}?tab=compare`],
  ['group ?tab=games', (s) => `${s.group}?tab=games`],
  ['group consensus', (s) => `${s.group}/consensus`],
  ['group divergent', (s) => `${s.group}/divergent`],
  ['group hidden gems', (s) => `${s.group}/hidden-gems`],
  ['group top games', (s) => `${s.group}/top-games`],
  ['group top rated', (s) => `${s.group}/top-rated`],
  ['genre hub', (s) => s.genre],
  ['platform hub', (s) => s.platform],
  ['studio hub', (s) => s.studio],
];

for (const [name, pathOf] of DYNAMIC_PAGES) {
  test(`dynamic page: ${name}`, async ({ page, request }) => {
    const path = pathOf(await getSamples(request));
    const health = watch(page);
    await openPage(page, path);
    await health.expectHealthy();
  });
}

// Partial routes that pages fetch and insert (lazy tabs, filters). They return
// HTML fragments, not full pages.
const PARTIALS: [string, (s: Samples) => string][] = [
  ['reviewer tab: reviews', (s) => `${s.reviewer}/tab/reviews`],
  ['reviewer tab: recommendations', (s) => `${s.reviewer}/tab/recommendations`],
  ['reviewer tab: lists', (s) => `${s.reviewer}/tab/lists`],
  ['reviewer tab: library', (s) => `${s.reviewer}/tab/library`],
  ['group feed partial', (s) => `${s.group}/feed`],
  ['group compare partial', (s) => `${s.group}/compare`],
];

for (const [name, pathOf] of PARTIALS) {
  test(`partial: ${name}`, async ({ request }) => {
    const path = pathOf(await getSamples(request));
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect((await res.text()).trim().length, `${path} returned an empty body`).toBeGreaterThan(0);
  });
}

test('unknown URL returns the 404 page', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist-smoke-test');
  expect(res?.status()).toBe(404);
});
