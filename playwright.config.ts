import { defineConfig, devices } from '@playwright/test';

// Smoke tests: load the site as a logged-out visitor and check every page
// renders without server errors or JavaScript exceptions. Read-only — safe to
// point at production.
//
//   npm run test:smoke                                   → starts `npm run dev` (or reuses it)
//   SMOKE_BASE_URL=https://deploy-preview-12--<site>.netlify.app npm run test:smoke
//
// See tests/README.md.
const baseURL = process.env.SMOKE_BASE_URL?.replace(/\/$/, '') || 'http://localhost:4321';
const isLocal = !process.env.SMOKE_BASE_URL;

export default defineConfig({
  testDir: './tests/smoke',
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
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
