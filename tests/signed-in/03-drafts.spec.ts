import { test, expect } from '@playwright/test';
import { watch } from '../smoke/helpers';
import { RUN_MARKER, requireAccounts, storageStatePath } from './accounts';

// A saves a review draft, finds it on /drafts, reopens it in the composer and
// deletes it from /drafts. Drafts are private: no one else sees or is
// notified of them.

requireAccounts();
test.use({ storageState: storageStatePath('a') });

test('save, resume and delete a review draft', async ({ page }) => {
  const health = watch(page);
  const body = `${RUN_MARKER} draft written by the signed-in test suite.`;

  // Any game will do: drafts don't conflict with a published review.
  const search = await page.request.get('/api/games/search?q=zelda');
  expect(search.status()).toBe(200);
  const results = await search.json();
  // Results can include IGDB-only games not yet imported; take one already in our DB.
  const gameId: string | undefined = (results as { id?: string; source?: string }[])
    .find((g) => g.source === 'db' && g.id)?.id;
  expect(gameId, 'game search returned no game id').toBeTruthy();

  const created = await page.request.post('/api/reviews/create', {
    data: { game_id: gameId, status: 'draft', body },
  });
  expect(created.status(), await created.text()).toBe(200);
  const { draft_id: draftId } = await created.json();
  expect(draftId).toBeTruthy();

  try {
    // Listed on /drafts.
    await page.goto('/drafts');
    const card = page.locator('.draft-card').filter({ hasText: RUN_MARKER });
    await expect(card).toHaveCount(1);

    // "Continue" reopens it in the game page's composer with the text in place.
    const continueHref = await card.locator('a.draft-continue').getAttribute('href');
    expect(continueHref).toContain(`draft=${draftId}`);
    await page.goto(continueHref!);
    await expect(page.locator('#gcBody')).toHaveValue(body);

    // Delete from /drafts (the page asks to confirm).
    await page.goto('/drafts');
    page.once('dialog', (d) => d.accept());
    await page.locator('.draft-card').filter({ hasText: RUN_MARKER }).locator('.draft-delete').click();
    await expect(page.locator('.draft-card').filter({ hasText: RUN_MARKER })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.draft-card').filter({ hasText: RUN_MARKER })).toHaveCount(0);

    await health.expectHealthy();
  } finally {
    // Gone whatever happened above. Deleting an already-deleted draft is harmless.
    await page.request.post('/api/reviews/delete', { data: { review_id: draftId } });
  }
});
