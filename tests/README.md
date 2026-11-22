# Tests

Run these before and after any significant change (a refactor, a merge, a
dependency bump). If something that passed before fails after, the change broke it.

| Command | What it checks | Time |
|---------|----------------|------|
| `npm test` | Unit tests for `src/utils` (Vitest, `src/**/*.test.ts`) | ~1 s |
| `npx astro check` | TypeScript across every page, component and route | ~30 s |
| `npm run test:smoke` | Browser smoke tests: the site as a logged-out visitor (Playwright, `tests/smoke/`) | ~1–4 min |
| `npm run check:all` | All three, in that order | ~2–5 min |
| `npm run test:signed-in` | Signed-in browser tests with two test accounts (`tests/signed-in/`). **Writes data** — see below | ~2 min |

## First-time setup

```bash
npm install
npx playwright install chromium
```

## Smoke tests

They open the real site in Chromium and check, for every page a logged-out
visitor can reach (about 80 checks, desktop + a few on a phone-sized screen):

- the page answers 200 and renders content;
- no uncaught JavaScript errors and no `console.error`s;
- no 4xx/5xx requests to our own site (images, API calls, lazy tabs);
- pages that need an account redirect to `/signin`; write APIs answer 401;
- client behaviour: game tabs switch, profile tabs lazy-load, the stats tab
  draws, search shows results, a signed-out vote sends you to sign in;
- RSS, sitemap, robots.txt, OG images and the game search API respond;
- no sideways scrolling on phones for the main pages.

They are **read-only** — no sign-in, no writes — so they are safe against
production. Specific pages (a game, a reviewer, a group…) are found from links
on the live home page, so no ids are hardcoded and the suite works on any
environment with data.

### Where to point them

```bash
# Local dev server (starts `npm run dev`, or reuses one already on :4321)
npm run test:smoke

# A Netlify deploy preview / branch deploy, or production
SMOKE_BASE_URL=https://chekpoint.gg npm run test:smoke
```

On Windows PowerShell: `$env:SMOKE_BASE_URL="https://chekpoint.gg"; npm run test:smoke`

Against the local dev server the first run is slower: Astro compiles each page
on its first request.

### When one fails

```bash
npm run test:smoke:report   # opens the HTML report: error, screenshot, trace
npx playwright test -g "game"           # rerun only tests whose name matches
npx playwright test --headed -g "game"  # watch it in a real browser window
```

The report shows which check failed — e.g. `ReferenceError: scoreClass is not
defined` from a page script, or `500` from a page's server code.

## Signed-in tests

`npm run test:signed-in` signs two dedicated test accounts in through the real
`/signin` form and drives the site as them, one test at a time:

| File | What it does | Writes |
|------|--------------|--------|
| `01-pages.spec.ts` | ~25 pages render signed in (settings, drafts, notifications, own profile, composers…); comment threads show the composer | none (viewing `/notifications` marks A's own as read) |
| `02-follow.spec.ts` | B follows A from A's profile, A sees it in notifications, B unfollows | a follow (removed), a notification to A |
| `03-drafts.spec.ts` | A saves a review draft, finds it on `/drafts`, reopens it in the composer, deletes it | a draft (soft-deleted) |
| `99-signout.spec.ts` | Fresh sign-in and sign-out through the UI | none |

With no accounts configured, every signed-in test is skipped — nothing runs.

### Rules that keep it contained

- Every action is between the two test accounts, so **no real user is ever
  notified**. Nothing is published.
- Usernames must contain `test`. If either account doesn't, the suite stops
  before doing anything — it can't be pointed at a real person's account.
- Anything a test creates carries a `[smoke-test <time>]` marker and is deleted
  in a `finally` block, even when the test fails.
- Never in CI and never retried (a retry would repeat writes).

### Setting up the accounts (once)

1. Sign up two accounts with usernames containing `test` (e.g. `chekpoint-test-a`,
   `chekpoint-test-b`), and confirm both emails.
2. Sign in to each once and finish (or skip) onboarding, so the wizard doesn't
   cover the page during tests.
3. Leave **Search engine visibility** off in Settings on both (it's off by
   default), so test content stays out of Google and the RSS feed.
4. Add to your `.env` (gitignored — never commit these):

   ```
   TEST_USER_A_EMAIL=...
   TEST_USER_A_PASSWORD=...
   TEST_USER_B_EMAIL=...
   TEST_USER_B_PASSWORD=...
   ```

Saved sessions go to `tests/.auth/` (gitignored).

### Not covered yet: publishing

Publishing a review notifies **every user who has that game on their
want-to-play / playing list** (`finalizePublishedReview` in
`src/utils/reviewPublish.ts`), so a test that publishes on production would
notify real people. Publishing, voting, reacting and commenting on reviews
(which need a published review) will run only on a game you've confirmed
nobody tracks, or on a separate test database.

## GitHub

- **Checks** (`.github/workflows/checks.yml`) runs `astro check` + unit tests on
  every PR and every push to `main`. No secrets needed.
- **Smoke tests** (`.github/workflows/smoke.yml`) runs the browser suite against a
  URL you give it: Actions tab → *Smoke tests* → *Run workflow* → paste the
  deploy-preview URL. The report is attached to the run as an artifact.

## For Claude agents

Before calling a change done: run `npm run check:all` (or at least `npm test`,
`npx astro check` and `npm run test:smoke`) and report the results. A failing
smoke test is a regression unless the change was meant to alter that page —
then update the test in the same change and say why.

## Adding tests

- **A new shared helper in `src/utils`** → a `*.test.ts` next to it covering its
  edge cases (null input, boundaries).
- **A new page** → add its path to `PUBLIC_PAGES` or `DYNAMIC_PAGES` in
  `tests/smoke/pages.spec.ts`, and to `PAGES` in `tests/signed-in/01-pages.spec.ts`
  if it looks different signed in.
- **A deliberate behaviour change** (a page made public, a limit raised) → update
  the test in the same change, with a comment naming the commit.
- **New client behaviour** (a tab, a toggle, a lazy load) → a test in
  `tests/smoke/interactions.spec.ts`.
- **An expected 4xx** (a signed-out action that's refused on purpose) → pass it
  to that test's `watch(page, { allow4xx: [...] })` with a comment saying why.
  Never add it globally.
