import { test, expect } from '@playwright/test';
import { watch } from '../smoke/helpers';
import { account, requireAccounts, signedInContext } from './accounts';

// B follows and unfollows A through the button on A's profile. Touches only
// the two test accounts: A gets a "new follower" notification from B.

requireAccounts();

test('follow and unfollow from a profile page', async ({ browser }) => {
  const a = account('a');
  const b = await signedInContext(browser, 'b');
  const page = await b.newPage();
  const health = watch(page);
  const profile = `/reviewers/${a.username}`;

  try {
    await page.goto(profile);
    const btn = page.locator('#followBtn');
    await expect(btn).toBeVisible();

    // A previous run that died mid-test may have left B following A.
    if ((await btn.getAttribute('data-following')) === 'true') {
      await btn.click();
      await expect(btn).toHaveAttribute('data-following', 'false');
    }

    await btn.click();
    await expect(btn).toHaveAttribute('data-following', 'true');
    await expect(page.locator('#notifyBtn')).toBeVisible();

    // It stuck: a fresh load still shows "Following".
    await page.reload();
    await expect(page.locator('#followBtn')).toHaveAttribute('data-following', 'true');

    // A sees B among their notifications.
    const aCtx = await signedInContext(browser, 'a');
    const aPage = await aCtx.newPage();
    const aHealth = watch(aPage);
    await aPage.goto('/notifications');
    await expect(aPage.locator(`a[href="/reviewers/${account('b').username}"]`).first()).toBeAttached();
    await aHealth.expectHealthy();
    await aCtx.close();

    // Unfollow.
    await page.locator('#followBtn').click();
    await expect(page.locator('#followBtn')).toHaveAttribute('data-following', 'false');
    await expect(page.locator('#notifyBtn')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#followBtn')).toHaveAttribute('data-following', 'false');

    await health.expectHealthy();
  } finally {
    // Leave B not following A whatever happened above.
    const profileId = await page.locator('#followBtn').getAttribute('data-reviewer-id').catch(() => null);
    if (profileId) await page.request.delete('/api/follows/toggle', { data: { following_id: profileId } });
    await b.close();
  }
});
