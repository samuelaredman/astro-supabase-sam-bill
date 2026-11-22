import fs from 'node:fs';
import path from 'node:path';
import { test, type Browser, type BrowserContext } from '@playwright/test';

// The two test accounts. A is the "author", B the "other person" — every
// cross-user action (follow, vote, comment) goes between them, so nobody
// outside the pair is ever notified.

export type Who = 'a' | 'b';

export const AUTH_DIR = path.join('tests', '.auth');
const ACCOUNTS_FILE = path.join(AUTH_DIR, 'accounts.json');

export function credentials(who: Who): { email: string; password: string } | null {
  const key = who.toUpperCase();
  const email = process.env[`TEST_USER_${key}_EMAIL`];
  const password = process.env[`TEST_USER_${key}_PASSWORD`];
  return email && password ? { email, password } : null;
}

export const hasAccounts = () => !!credentials('a') && !!credentials('b');

/** Skips the calling test file when the test accounts aren't configured. */
export function requireAccounts() {
  test.skip(!hasAccounts(), 'TEST_USER_A_* / TEST_USER_B_* not set — see tests/README.md');
}

/** Usernames are what lets a test refuse to run against a real person's account. */
export function assertTestUsername(username: string) {
  if (!/test/i.test(username)) {
    throw new Error(
      `Refusing to run: signed in as "${username}", whose username doesn't contain "test". ` +
        'Signed-in tests write data — use dedicated test accounts only.',
    );
  }
}

export type AccountInfo = { username: string };

export function saveAccounts(info: Record<Who, AccountInfo>) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(info, null, 2));
}

export function account(who: Who): AccountInfo {
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))[who];
}

export const storageStatePath = (who: Who) => path.join(AUTH_DIR, `${who}.json`);

/** A browser context signed in as `who` (from the session auth.setup.ts saved). */
export function signedInContext(browser: Browser, who: Who): Promise<BrowserContext> {
  return browser.newContext({ storageState: storageStatePath(who) });
}

/** Text that marks everything a run creates, so leftovers are easy to spot and sweep. */
export const RUN_MARKER = `[smoke-test ${new Date().toISOString().replace(/[:.]/g, '-')}]`;
