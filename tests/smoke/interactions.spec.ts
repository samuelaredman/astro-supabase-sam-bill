import { test, expect } from '@playwright/test';
import { watch, openPage, getSamples } from './helpers';

// Client-side behaviour a logged-out visitor can trigger. Most of the code
// being consolidated lives in page <script>s, so these catch what a status
// check can't: a renamed function, a missing import, a handler that no
// longer fires.

test('home feed renders review cards', async ({ page }) => {
  const health = watch(page);
  await openPage(page, '/');
  await expect(page.locator('.rc').first()).toBeVisible();
  await health.expectHealthy();
});

test('game page tabs switch panels', async ({ page, request }) => {
  const { game } = await getSamples(request);
  const health = watch(page);
  await openPage(page, game);
  for (const tab of ['reviews', 'stats', 'recommendations', 'overview']) {
    await page.locator(`a.tab-link[data-tab="${tab}"]`).click();
    await expect(page.locator(`.tab-panel[data-tab="${tab}"]`)).toHaveClass(/\bactive\b/);
  }
  await health.expectHealthy();
});

test('game stats tab draws its charts', async ({ page, request }) => {
  const { game } = await getSamples(request);
  const health = watch(page);
  await openPage(page, `${game}?tab=stats`);
  const stats = page.locator('#statsContent');
  if (await stats.count()) {
    // Built client-side by buildStats(); empty only when the game has no reviews.
    await expect(stats).not.toBeEmpty();
  }
  await health.expectHealthy();
});

test('reviewer profile lazy tabs load on click', async ({ page, request }) => {
  const { reviewer } = await getSamples(request);
  const health = watch(page);
  await openPage(page, reviewer);
  for (const tab of ['reviews', 'library', 'lists', 'recommendations']) {
    const link = page.locator(`a.tab-link[href*="tab=${tab}#"]`);
    if (!(await link.count())) continue; // tab hidden for this profile
    await link.click();
    const panel = page.locator(`.tab-panel[data-tab="${tab}"]`);
    await expect(panel).toHaveClass(/\bactive\b/);
    // Server-rendered panels have no data-src; lazy ones get data-loaded="1".
    if (await panel.getAttribute('data-src')) {
      await expect(panel).toHaveAttribute('data-loaded', '1');
    }
    await expect(panel.locator('.tab-lazy-error')).toHaveCount(0);
  }
  await health.expectHealthy();
});

test('reviewer stats tab renders', async ({ page, request }) => {
  const { reviewer } = await getSamples(request);
  const health = watch(page);
  await openPage(page, reviewer);
  const link = page.locator('a.tab-link[href*="tab=stats#"]');
  await link.click();
  await expect(page.locator('.tab-panel[data-tab="stats"]')).toHaveClass(/\bactive\b/);
  await health.expectHealthy();
});

test('search page shows results for a query', async ({ page }) => {
  const health = watch(page);
  await openPage(page, '/search?q=zelda');
  await expect(page.locator('main a[href^="/games/"]').first()).toBeVisible();
  await health.expectHealthy();
});

test('group page tabs load', async ({ page, request }) => {
  const { group } = await getSamples(request);
  const health = watch(page);
  for (const tab of ['overview', 'feed', 'compare']) {
    await openPage(page, `${group}?tab=${tab}`);
    await expect(page.locator(`a.tab-link.active[href*="tab=${tab}"]`)).toBeVisible();
  }
  await health.expectHealthy();
});

test('review page shows the review and its game', async ({ page, request }) => {
  const { review } = await getSamples(request);
  const health = watch(page);
  await openPage(page, review);
  await expect(page.locator('a[href^="/games/"]').first()).toBeVisible();
  await health.expectHealthy();
});

test('signed-out vote click asks the visitor to sign in', async ({ page }) => {
  // The click POSTs, gets 401, and review-card.ts then sends the visitor to /signin.
  const health = watch(page, { allow4xx: [/^\/api\/reviews\/vote$/] });
  await openPage(page, '/');
  const vote = page.locator('.rc [data-vote]').first();
  test.skip(!(await vote.count()), 'no vote buttons on the home feed');
  await vote.click();
  // Either navigates to /signin or opens a sign-in prompt; never a silent no-op error.
  await expect
    .poll(async () => page.url().includes('/signin') || (await page.locator('text=/sign in/i').first().isVisible()))
    .toBe(true);
  await health.expectHealthy();
});
