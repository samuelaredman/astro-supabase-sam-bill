import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test';

/**
 * Records everything that can go wrong on a page while a test drives it:
 * uncaught JS exceptions, console errors, and failed same-site requests.
 * Call `watch(page)` before navigating and `await expectHealthy()` at the end.
 *
 * `allow4xx` lists paths a test expects to answer 4xx (e.g. a signed-out vote
 * gets 401 before the page sends the visitor to /signin). Any other 4xx on our
 * own site fails the test.
 */
export function watch(page: Page, { allow4xx = [] as RegExp[] } = {}) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];

  page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // The browser logs every failed request as "Failed to load resource";
    // those are judged below with their URL, so skip the URL-less copy here.
    if (text.startsWith('Failed to load resource')) return;
    consoleErrors.push(text);
  });
  page.on('response', (res: Response) => {
    if (!isOurs(res.url())) return;
    const status = res.status();
    const path = new URL(res.url()).pathname;
    if (status >= 500 || (status >= 400 && !allow4xx.some((re) => re.test(path)))) {
      badResponses.push(`${status} ${res.request().method()} ${res.url()}`);
    }
  });

  return {
    pageErrors,
    consoleErrors,
    badResponses,
    async expectHealthy() {
      expect.soft(pageErrors, 'uncaught JavaScript errors').toEqual([]);
      expect.soft(consoleErrors, 'console errors').toEqual([]);
      expect.soft(badResponses, 'failed requests to our own site').toEqual([]);
    },
  };
}

// Same default as playwright.config.ts.
const ORIGIN = new URL(process.env.SMOKE_BASE_URL || 'http://localhost:4321').origin;

/** Requests to our own origin (pages, API routes, assets) — not CDNs or third parties. */
function isOurs(url: string): boolean {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

/** Navigate and assert a 200 page with a title and real content on screen. */
export async function openPage(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.status(), `status for ${path}`).toBe(200);
  await expect(page).toHaveTitle(/\S/);
  // Layouts differ (sidebar, top nav, bare back-link pages), so check for
  // rendered text rather than a particular nav element.
  const text = await page.locator('body').innerText();
  expect(text.trim().length, `${path} rendered almost no text`).toBeGreaterThan(100);
  return res!;
}

// ── Sample URLs ────────────────────────────────────────────────────────────
// Dynamic pages (a game, a reviewer, a review...) are found by reading links
// off live listing pages, so the suite works against any environment with data
// and never hardcodes ids. Cached per worker.

export type Samples = {
  game: string;
  reviewer: string;
  review: string;
  list: string;
  recommendation: string;
  update: string;
  group: string;
  genre: string;
  platform: string;
  studio: string;
};

let samplesPromise: Promise<Samples> | null = null;

export function getSamples(request: APIRequestContext): Promise<Samples> {
  samplesPromise ??= findSamples(request);
  return samplesPromise;
}

async function html(request: APIRequestContext, path: string): Promise<string> {
  const res = await request.get(path);
  expect(res.status(), `status for ${path} while finding sample URLs`).toBe(200);
  return res.text();
}

function firstLink(source: string, prefix: string, label: string): string {
  // Matches href="/games/foo" but not template strings like "/updates/' + id + '".
  const re = new RegExp(`href="(${prefix}/[A-Za-z0-9._~%-]+)"`);
  const m = source.match(re);
  if (!m) throw new Error(`Could not find a ${label} link (${prefix}/…) to test with.`);
  return m[1];
}

async function findSamples(request: APIRequestContext): Promise<Samples> {
  const home = await html(request, '/');
  const updates = await html(request, '/updates');
  const game = firstLink(home, '/games', 'game');
  const gamePage = await html(request, game);
  return {
    game,
    reviewer: firstLink(home, '/reviewers', 'reviewer'),
    review: firstLink(home, '/reviews', 'review'),
    list: firstLink(home, '/lists', 'list'),
    recommendation: firstLink(home, '/recommendations', 'recommendation'),
    update: firstLink(updates, '/updates', 'update post'),
    group: firstLink(home, '/groups', 'group'),
    genre: firstLink(gamePage, '/genres', 'genre'),
    platform: firstLink(gamePage, '/platforms', 'platform'),
    studio: firstLink(gamePage, '/studios', 'studio'),
  };
}
