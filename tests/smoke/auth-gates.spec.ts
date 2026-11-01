import { test, expect } from '@playwright/test';
import { getSamples } from './helpers';

// Pages that need an account must send a logged-out visitor away — never
// render half a page or a 500.

const SIGNED_IN_ONLY = [
  '/profile',
  '/settings',
  '/drafts',
  '/notifications',
  '/groups',
  '/groups/create',
];

async function expectRedirect(request: import('@playwright/test').APIRequestContext, path: string, to: RegExp) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect([301, 302, 303, 307, 308], `${path} should redirect, got ${res.status()}`).toContain(res.status());
  expect(res.headers()['location'] ?? '', `${path} redirect target`).toMatch(to);
}

for (const path of SIGNED_IN_ONLY) {
  test(`${path} sends logged-out visitors to sign in`, async ({ request }) => {
    await expectRedirect(request, path, /\/signin/);
  });
}

test('/contact sends logged-out visitors to sign in and back', async ({ request }) => {
  await expectRedirect(request, '/contact', /\/signin\?next=\/contact/);
});

test('group settings and requests send logged-out visitors to sign in', async ({ request }) => {
  const { group } = await getSamples(request);
  await expectRedirect(request, `${group}/settings`, /\/signin/);
  await expectRedirect(request, `${group}/requests`, /\/signin/);
});

test('/admin is hidden from logged-out visitors', async ({ request }) => {
  await expectRedirect(request, '/admin', /\/404/);
});

test('write APIs refuse logged-out requests', async ({ request }) => {
  // Each must answer 401 (or 403) without doing anything. Empty bodies on
  // purpose — if auth were missing, validation would reject them anyway.
  for (const path of [
    '/api/reviews/create',
    '/api/reviews/vote',
    '/api/comments/create',
    '/api/follows/toggle',
    '/api/watchlist/toggle',
    '/api/profile/update',
  ]) {
    const res = await request.post(path, { data: {} });
    expect([401, 403], `${path} answered ${res.status()}`).toContain(res.status());
  }
});
