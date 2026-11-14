import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only. Browser smoke tests in tests/smoke run under Playwright.
    include: ['src/**/*.test.ts'],
  },
});
