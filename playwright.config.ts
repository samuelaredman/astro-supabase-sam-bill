import { defineConfig, devices } from '@playwright/test';

// Two suites, see tests/README.md.
//
// Smoke tests (tests/smoke): the site as a logged-out visitor. Read-only —
// safe to point at production.
//   npm run test:smoke                                   → starts `npm run dev` (or reuses it)
//   SMOKE_BASE_URL=https://deploy-preview-12--<site>.netlify.app npm run test:smoke
//
// Signed-in tests (tests/signed-in): two dedicated test accounts, from
// TEST_USER_A_* / TEST_USER_B_* in .env. They write, so they never run unless
// asked for: `npm run test:signed-in`.

// Pick up TEST_USER_* (and SMOKE_BASE_URL) from .env like the dev server does.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env (CI, a fresh clone): the variables come from the environment.
}

const baseURL = process.env.SMOKE_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4321';
const isLocal = !process.env.SMOKE_BASE_URL;

export default defineConfig({
  testDir: './tests',
  // The dev server compiles each page on its first request; the big pages
  // (reviewer profile, group page) can take a while the first time.
  timeout: isLocal ? 120_000 : 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // The dev server is single-process; too many workers just queue up behind it.
  workers: isLocal ? 2 : 4,
  // A deployed site can be slow on a cold serverless start. One retry there;
  // a test that only passes on retry shows as "flaky" in the report, not hidden.
  retries: isLocal ? 0 : 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testDir: './tests/smoke',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testDir: './tests/smoke',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'signed-in-setup',
      testDir: './tests/signed-in',
      testMatch: /auth\.setup\.ts/,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'signed-in',
      testDir: './tests/signed-in',
      testMatch: /\.spec\.ts$/,
      dependencies: ['signed-in-setup'],
      // They share two accounts: one at a time, in file order (run with --workers=1),
      // and never retried — a retry would repeat writes.
      fullyParallel: false,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isLocal
    ? {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
