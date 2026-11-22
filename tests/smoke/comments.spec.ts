import { test, expect } from '@playwright/test';
import { watch, openPage, getSamples, type Samples } from './helpers';

// The shared CommentThread (src/components/CommentThread.astro) on every page
// that uses it. One component, five pages: a change to it shows up here.

const THREAD_PAGES: [string, string, (s: Samples) => string | null][] = [
  // [name, data-ct-target-type, path]
  ['review', 'review_comment', (s) => s.review],
  ['list', 'list_comment', (s) => s.list],
  ['recommendation', 'recommendation_comment', (s) => s.recommendation],
  ['update post', 'forum_post_comment', (s) => s.update],
  ['group poll', 'poll_answer', (s) => s.poll],
];

for (const [name, targetType, pathOf] of THREAD_PAGES) {
  test(`comment thread on ${name} page`, async ({ page, request }) => {
    const path = pathOf(await getSamples(request));
    test.skip(!path, `no public ${name} page to test with`);
    const health = watch(page);
    await openPage(page, path!);

    const thread = page.locator('.ct-thread').first();
    await expect(thread).toBeVisible();
    await expect(thread).toHaveAttribute('data-ct-target-type', targetType);
    await expect(thread).toHaveAttribute('data-ct-target-id', /\S/);
    // Logged out: a sign-in prompt instead of the composer, linking back here.
    const prompt = thread.locator('.ct-signin-prompt');
    if (await prompt.count()) {
      await expect(prompt.locator('a')).toHaveAttribute('href', /\/signin/);
    }
    await expect(thread.locator('.ct-composer')).toHaveCount(0);
    await health.expectHealthy();
  });
}

test('giveaway page renders', async ({ page }) => {
  const health = watch(page);
  await openPage(page, '/giveaway');
  await health.expectHealthy();
});
