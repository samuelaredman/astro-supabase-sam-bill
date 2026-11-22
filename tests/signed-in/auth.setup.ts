import { test as setup, expect, type Page } from '@playwright/test';
import {
  assertTestUsername,
  credentials,
  hasAccounts,
  saveAccounts,
  storageStatePath,
  type AccountInfo,
  type Who,
} from './accounts';

// Signs both test accounts in through the real /signin form, checks they are
// test accounts, and saves each session for the signed-in tests to reuse.

async function signIn(page: Page, who: Who): Promise<AccountInfo> {
  const creds = credentials(who)!;
  await page.goto('/signin');
  await page.locator('#email').fill(creds.email);
  await page.locator('#password').fill(creds.password);
  await page.locator('#submitBtn').click();
  await expect(page, `account ${who.toUpperCase()} could not sign in`).not.toHaveURL(/\/signin/, { timeout: 30_000 });

  // The sidebar's Profile link points at /reviewers/<own username>.
  await page.goto('/');
  const href = await page.locator('a.nav-item[href^="/reviewers/"]').first().getAttribute('href');
  const username = decodeURIComponent(href?.split('/').pop() ?? '');
  expect(username, `couldn't read account ${who.toUpperCase()}'s username`).not.toBe('');
  assertTestUsername(username);

  await page.context().storageState({ path: storageStatePath(who) });
  return { username };
}

setup('sign in both test accounts', async ({ browser }) => {
  setup.skip(!hasAccounts(), 'TEST_USER_A_* / TEST_USER_B_* not set — see tests/README.md');

  const info = {} as Record<Who, AccountInfo>;
  for (const who of ['a', 'b'] as const) {
    const context = await browser.newContext();
    info[who] = await signIn(await context.newPage(), who);
    await context.close();
  }
  expect(info.a.username, 'TEST_USER_A and TEST_USER_B must be different accounts').not.toBe(info.b.username);
  saveAccounts(info);
});
