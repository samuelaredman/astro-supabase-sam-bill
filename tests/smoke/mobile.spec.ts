import { test, expect } from '@playwright/test';
import { watch, openPage, getSamples, type Samples } from './helpers';

// Runs in the "mobile" project (Pixel 7). Key pages fit the screen: no
// sideways scrolling, and no JS errors from mobile-only code paths.

const PAGES: [string, (s: Samples) => string][] = [
  ['home', () => '/'],
  ['search', () => '/search?q=zelda'],
  ['game', (s) => s.game],
  ['reviewer', (s) => s.reviewer],
  ['review', (s) => s.review],
  ['group', (s) => s.group],
  ['genre hub', (s) => s.genre],
];

for (const [name, pathOf] of PAGES) {
  test(`mobile: ${name} fits the screen`, async ({ page, request }) => {
    const path = pathOf(await getSamples(request));
    const health = watch(page);
    await openPage(page, path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    await health.expectHealthy();
  });
}
