import { test, expect } from '@playwright/test';
import { watch, openPage, getSamples, type Samples } from '../smoke/helpers';
import { account, requireAccounts, storageStatePath } from './accounts';

// Every page renders for a signed-in visitor — the code paths a logged-out
// smoke test never reaches (composers, owner menus, notification badge,
// settings). Read-only: viewing /notifications marks the account's own
// notifications read, nothing else.

requireAccounts();
test.use({ storageState: storageStatePath('a') });

const PAGES: [string, (s: Samples) => string][] = [
  ['home', () => '/'],
  ['profile', () => '/profile'],
  ['settings', () => '/settings'],
  ['drafts', () => '/drafts'],
  ['notifications', () => '/notifications'],
  ['following feed', () => '/following'],
  ['groups', () => '/groups'],
  ['create group', () => '/groups/create'],
  ['discover', () => '/discover'],
  ['search', () => '/search?q=zelda'],
  ['own reviewer page', () => `/reviewers/${account('a').username}`],
  ['own reviewer library', () => `/reviewers/${account('a').username}?tab=library`],
  ['someone else\'s reviewer page', (s) => s.reviewer],
  ['game', (s) => s.game],
  ['game ?tab=reviews', (s) => `${s.game}?tab=reviews`],
  ['review', (s) => s.review],
  ['list', (s) => s.list],
  ['recommendation', (s) => s.recommendation],
  ['update post', (s) => s.update],
  ['group', (s) => s.group],
  ['group ?tab=feed', (s) => `${s.group}?tab=feed`],
  ['group ?tab=compare', (s) => `${s.group}?tab=compare`],
  ['genre hub', (s) => s.genre],
];

for (const [name, pathOf] of PAGES) {
  test(`signed in: ${name}`, async ({ page, request }) => {
    const path = pathOf(await getSamples(request));
    const health = watch(page);
    await openPage(page, path);
    // Still signed in (an expired session would bounce to /signin).
    expect(page.url()).not.toMatch(/\/signin/);
    await health.expectHealthy();
  });
}

test('signed in: comment threads show the composer, not the sign-in prompt', async ({ page, request }) => {
  const s = await getSamples(request);
  for (const path of [s.review, s.list, s.recommendation, s.update]) {
    const health = watch(page);
    await openPage(page, path);
    const thread = page.locator('.ct-thread').first();
    await expect(thread, path).toBeVisible();
    await expect(thread.locator('.ct-composer'), path).toBeVisible();
    await expect(thread.locator('.ct-signin-prompt'), path).toHaveCount(0);
    await health.expectHealthy();
  }
});
