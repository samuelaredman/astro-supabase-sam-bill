import { test, expect } from '@playwright/test';
import { credentials, requireAccounts } from './accounts';

// Runs last: signing out revokes all of the account's sessions, including the
// one the other tests share. Uses its own fresh sign-in as B.

requireAccounts();

test('sign in and sign out through the UI', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const creds = credentials('b')!;

  await page.goto('/signin');
  await page.locator('#email').fill(creds.email);
  await page.locator('#password').fill(creds.password);
  await page.locator('#submitBtn').click();
  await expect(page).not.toHaveURL(/\/signin/, { timeout: 30_000 });

  // Signed in: /settings opens instead of redirecting.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings/);

  // The settings page's sign-out form.
  await page.locator('form[action="/api/auth/signout"] .settings-signout-btn').click();
  await expect(page).toHaveURL(/\/$/);

  // Signed out: gated pages send you to /signin again.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/signin/);
  await context.close();
});
