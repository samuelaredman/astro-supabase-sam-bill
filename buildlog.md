# Chekpoint — Build Log

A chronological summary of everything built since this repo became Chekpoint, generated from
git history (1,047 commits total). Draft for review — flag anything that's wrong, missing, or
should be cut before this gets finalized.

**Contributors:** Samuel Redman (Sam), protobill (Bill), plus a handful of early commits from
Tomas Bankauskas and Suzanne Aitchison on the original template before it was forked.

---

## Before Chekpoint: the starter template (Nov 2024 – Mar 2026)

This repo began life as Netlify's official Astro + Supabase starter template. From Nov 2024
through March 2026 the only activity was the template maintainers' own updates (Astro 4→5,
Tailwind 3→4, Supabase JS bumps) plus routine `renovate`/`dependabot` dependency PRs — no
Chekpoint-specific code exists from this period. Sam forked it on **2026-03-25** and all real
product work starts from there.

---

## Phase 1 — Fork and foundation (Mar 25 – Apr 24, 2026)

The starter template stripped down and rebuilt into the beginning of a game review site.

- Forked the template, removed the starter's demo content (`frameworks` table/pages, guide
  content, old README), renamed to Chekpoint.
- Core Supabase auth: sign in, sign up, email confirmation (`confirm.ts`), forgot/reset
  password flow, cookie-based server client (`createSupabaseServerClientFromContext`).
- IGDB integration: `igdb.ts` fetch helper, a script to import games from IGDB into Supabase,
  auto-refreshing IGDB access tokens.
- First game detail pages (`/games/[slug]`), search (`/search`, fuzzy search RPC), platform
  pages (`/platforms/[slug]`), genre pages, developer/studio pages with game + review rollups.
- Layout/component foundation: `Layout.astro`, `Footer.astro`, `Header.astro`, first pass at
  shared styling.
- Bill built out platform/genre/studio pages in parallel — top-rated-by-console logic, fuzzy
  search + filters, banner/trailer display on game pages.

## Phase 2 — Reviews, social core, and the “does this even work” phase (Apr 29 – May 14, 2026)

The actual review-and-score product came together here, alongside the first big wave of
account/profile features.

- Review creation, editing (draft-save via edit modal), soft-delete, one-published-review-per-
  game constraint, spoiler blurring, character limits, duplicate-review blocking.
- Upvote/downvote on reviews, later comments with their own vote/reaction system and threaded
  replies (2-level threading, @mention prefill, edit/delete with "(edited)" indicator).
- Profile pages: avatar/banner upload (multiple rounds of fixing FOUC and render-timing bugs),
  favorite game showcase, follower/following counts and lists, stats tab with score
  distribution and scatterplots.
- Following feature, Hot Takes (disagreement feed), Watchlist, in-app notifications (follows,
  votes, comments, reactions) with unread counts.
- The "post-review reveal card" — shows how your score compared to the community average right
  after posting, with animation and a first-reviewer callout.
- Rankings page (Bayesian-averaged all-time leaderboard) with gold/silver/bronze
  medal/wreath styling — several iterations to get the wreath SVG to not look, in Bill's words,
  "stupid."
- Discover page with collaborative-filtering recommendations (early version, predates the July
  recommendations rebuild).
- Infra/perf: mobile nav + iOS notch fixes, dark-mode flash fixes, CDN caching for SSR pages
  (and the caching bug that briefly broke login for logged-in users), sitemap caching, and a
  crawler-cost incident ("cost us 450 credits overnight") that led to temporarily blocking all
  crawlers.
- Contact form + Terms/Privacy/About pages; a Supabase Edge Function to notify the team via
  Discord/email on new contact submissions.
- Settings page, sign-out (a late addition — "kind of shocked we overlooked this").
- GA4 analytics wired in (with a couple of follow-up fixes since auth pages weren't loading
  `Layout.astro`, so the tag never fired there).

## Phase 3 — Groups and library (May 18 – May 28, 2026)

- Platform/genre pages redesigned with Overview/Reviews/Stats tabs, year-picker histograms,
  custom banners and logos.
- Reactions (including custom image emotes) and a comment-count bubble added to review cards;
  a report menu for flagging content.
- **Groups**: shared watchlists, gaming sessions, member roles/invites, score-compare, a
  podium view for top group games, group-level stats (hot-take/critic-spectrum charts). This
  shipped with a long tail of bug fixes — 404s from a route-naming conflict between
  `[id].astro` and an `[id]/` directory, missing table grants, a missing `banner_url` column,
  stale invite/request states, and role-permission edge cases ("I don't even want to get into
  all of the bugs that are going to pop up from role issues" — accurate).
- **User game status / library**: renamed "watch" to "want-to-play," added a full library view
  with bulk edit, search/filter/sort, hidden-game management, and status badges.
- Image crop modal for avatar/banner uploads, GIF pan positioning, a 15MB banner size bump, and
  eventually a switch to direct browser-to-Supabase uploads to route around Netlify's 6MB
  function payload limit.
- `CLAUDE.md` added on 2026-05-24 — the repo instructions file every AI agent working on this
  codebase reads first.

## Phase 4 — Infra cleanup and Steam sync (Jun 1 – Jun 13, 2026)

- Refactor pass: centralized `requireAuth`/`json` helpers into `utils/api.ts`, removed `as any`
  casts, regenerated Supabase types, added `utils/format.ts` for shared formatting
  (`scoreClass`, `timeAgo`, `getVoteCounts`, `igdbImage`).
- **Steam integration**: OpenID sign-in, library sync with playtime import, a 1-minute sync
  cooldown, "only import played games" filter — this had a rough build ("freakin bugs" /
  "okay I explained to claude like it was a baby and i finally fixed it").
- Library rework: `is_hidden` flag, reviewed/unplayed/hidden filter checkboxes, hours-played and
  score badges on library cards, a settings gear panel for hidden-game management.
- Reviewer profile reorganization: followers/following tabs, games/hours-by-genre breakdowns,
  cleaned-up header layout.
- Reaction picker overhaul: emote-only picker with search, dozens of new custom emotes added.
- Game metadata backfill: categories/themes/franchises/collections pulled from IGDB for
  existing games, to support better search and future tagging.

## Phase 5 — Lists (Jun 14 – Jul 1, 2026)

A full ranked/unranked list feature, built and iterated on almost entirely by Bill:

- Create/edit ranked or unranked game lists with drag-and-drop reordering, custom cover images.
- Share lists to the main feed (`ListFeedCard`), with votes, reactions, and threaded comments —
  same social mechanics as reviews.
- List detail page: grid/list view toggle, sticky sidebar, stats card (genre breakdown, top
  developers/publishers/platforms, net votes), search/sort/filter controls.
- Public lists browse page with genre/vote filtering.
- Saved lists on profile, with a per-save hide toggle and a filter/sort bar.

## Phase 6 — Search cleanup, recommendations, sharing, admin tools (Jul 1 – Jul 3, 2026)

- **Search/category cleanup**: 15 IGDB categories classified so ports/DLC/bundles don't clutter
  search results, with an exception for notable bundle editions (GOTY, Master Chief
  Collection-style compilations); release years added to search results; the "add missing
  game" flow consolidated into the primary search path.
- **Sharing**: share buttons added to review cards, game pages, and profiles; clean OG previews.
- **Recommendations**: a new global `/recommendations` page and a profile-page version, several
  rounds of look-and-feel iteration (carousel, scroll-dot navigation), a sidebar preview widget
  on the home page, and a logged-in-but-no-data empty state nudging users to review 7+ games.
- **Onboarding**: a nag banner for incomplete profiles, and a rewritten `/welcome` page with a
  3-step tutorial (complete profile → sync Steam → find a game to review).
- **Steam sync bug hunt**: a production timeout bug (correlated-subquery matching function
  rewritten as proper joins + a trigram index), a title-collision bug (multiple DB rows sharing
  a title, e.g. three "BioShock" rows, causing duplicate library entries), and a Roman-numeral /
  "&"-vs-"and" title-normalization gap (Baldur's Gate III vs "3", Rabbit & Steel vs "and Steel").
- **Admin tools**: a new `/admin` section (gated to the existing but previously-unused
  `site_admins` table) with a queue for Steam titles that failed to match anything in the DB
  (so genuine catalog gaps can be found and imported instead of guessed at), and a reports
  queue for moderating flagged reviews/comments/profiles.
- **Auth flow audit and fix**: found and fixed three compounding bugs that had been silently
  breaking signup confirmation and password reset (estimated ~6 lost signups) — a redirect URL
  that didn't reliably match Supabase's allowlist behind Netlify, a confirmation link pointing
  at a page that never actually established a session, and a route that had never existed at
  the path everything referenced. All three fixed and verified end-to-end with real test
  accounts; documented in `CLAUDE.md` so it doesn't regress a fourth time.

---

## Notes on this draft

- This is organized by rough theme/phase, not a line-by-line commit list — 1,047 commits isn't
  a readable changelog at that granularity. Let me know if you want a fuller appendix of raw
  commits for any specific phase.
- Dates are commit dates, not necessarily when a feature actually shipped to production.
- Bug-fix commits are folded into the feature they belong to rather than listed separately,
  except where the fix was itself a notable saga (groups, Steam sync, auth).
