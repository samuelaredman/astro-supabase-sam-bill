# Chekpoint — Roadmap

**Status legend:** ✅ Done &nbsp;·&nbsp; 🚧 Partial &nbsp;·&nbsp; 📋 Todo &nbsp;·&nbsp; 💡 Idea (unplanned)
**Priority legend:** 🔴 High &nbsp;·&nbsp; 🟡 Medium &nbsp;·&nbsp; 🟢 Low

---

## 1. Feature Roadmap branches (from the May 27 planning sheet)

This was the most recent structured plan in the spreadsheet, organized as sequential branches.

| Branch | Status | Priority | Notes |
|---|---|---|---|
| 1 — `feature/group-visibility` | ✅ Done | — | `community` visibility ships (`create.ts` gates it on `is_group_admin`), auto-join via `20260526000002_group-community-visibility.sql`, private-group join-request flow shipped (`group_join_requests` table + `join-request/create.ts`/`respond.ts` + `/groups/[id]/requests.astro`). |
| 2 — `feature/game-status` | ✅ Done | — | `user_game_status` table, full library view with bulk edit/search/filter/sort, status toggle on game pages/profile. Shipped May 27–June 11. |
| 3 — `feature/activity-feed` | 📋 Todo | 🟡 Medium | Not found in the codebase — the Following tab still shows reviews only, no "started playing / completed / dropped" status items. Depends on #2, which is done, so this is unblocked whenever it's picked up. |
| 4 — `feature/group-scheduling` | 🚧 Partial | 🟡 Medium | `group_sessions` exists (date, notes, created_by) but only stores a plain date — no time-of-day/timezone field, no RSVP table, no "suggest a game from members' want-to-play lists" logic. |
| 5 — `feature/notifications` (prefs) | 📋 Todo | 🟢 Low | In-app notifications exist and are extensive, but the specific ask here — a `notification_preferences` table, Resend-based email notifications, per-group Discord webhooks, and a settings UI for it — isn't built. Resend is currently only wired to Supabase Auth's transactional emails and the contact-form/report Edge Functions, not to a user-configurable notification system. |
| 6 — `feature/about-us + faq` | ✅ Done (needs polish) | 🟢 Low | `/about` exists with FAQ-style content. The "reivew" → "review" typo flagged in the SEO doc is still present (line 45) and there's no meta description on the page — both are 5-minute fixes, see §4. |
| 7 — `feature/header` | ❓ Unclear | — | No commit or code maps clearly to this; scope was never spelled out in the notes either. Worth a quick conversation before prioritizing. |
| 8 — `feature/group-media` | 📋 Todo | 🟢 Low | Explicitly deferred at the time ("video: explicitly deferred"). Groups have no image-upload post/feed feature. |
| Google sign-in | 📋 Todo | 🟡 Medium | Not built — only email/password and Steam OpenID exist in `src/pages/api/auth/`. |
| Discord sign-in | 📋 Todo | 🟢 Low | Not built. |
| Username-based login | 📋 Todo | 🟢 Low | `signin.ts` only accepts email/password. |
| Sharing (reviews, lists, profiles) | ✅ Done | — | Shipped 2026-07-02 — share buttons on review cards, game pages, and profiles, with clean OG previews. |

---

## 2. Issues to Fix (spreadsheet sheet, May 17 – Jun 24 entries)

Most of these predate significant rework in the same areas, so I'm marking anything clearly
superseded by later commits as done, and flagging a handful I genuinely can't verify without
you testing them live.

| Issue | Status |
|---|---|
| Edit and delete reviews | ✅ Done (edit modal + soft delete shipped May 11) |
| Up/downvote should show total count, stay highlighted after voting | ✅ Done (vote persistence fixed May 19/24) |
| Following should show a list of people | ✅ Done (May 19 rework — people list + unfollow button) |
| Similar-game cards should show a score | ✅ Done (May 19 — avg score badges added) |
| Score color consistency across pages | ✅ Done (multiple passes May 19–24 standardized this) |
| Review search needs fuzzy matching | ✅ Done |
| 25k-hour upper limit on reviews | ✅ Done (Apr 29, later refined) |
| "Most/least upvoted" on profile reviews | 🚧 Believed fixed — vote sorting shipped, but I haven't directly re-tested the exact profile-page sort options from this note. Worth a quick check. |
| Favorite game selection doesn't work for some games | ❓ Unverified — no specific fix commit found; worth testing with an edge-case title. |
| Change password in settings | ✅ Done |
| Spoiler-blocked posts don't load/redirect | ✅ Done (spoiler handling reworked several times through May) |
| "Want to play" naming/watchlist rename | ✅ Done (renamed, then folded into the broader library/game-status system) |
| Most/least upvoted on game-page reviews | 🚧 Believed done via the same vote-sorting work, not individually re-verified |
| Game already in DB still shows "add to Chekpoint" in search | ❓ Unverified — the search/import consolidation (Jul 1) likely fixed this as a side effect, but I haven't confirmed directly. |
| Reaction row size changes with a 2nd row | ❓ Unverified — UI-level detail, needs a visual check |
| Library viewable when logged out | ❓ Unverified — worth a quick check as an anonymous visitor |
| Auto-mark "completed" on review even if already "owned" | ❓ Unverified |
| Hide "review this game" button after reviewing | ❓ Unverified |
| Manual review hours should count toward library hours (not just Steam) | ❓ Unverified — this depends on whether `user_game_status` hours get updated from `reviews.play_time_hours`; didn't find a clear link between the two in the code I reviewed. |
| Steam library sync reliability | ✅ Done — this was the subject of an extensive bug-hunt this session (timeout fix, title-collision fix, Roman-numeral/"&" normalization fix), all verified end-to-end. |
| "Hidden" checkbox doesn't work on game page / profile | ❓ Unverified |
| Manually-entered hours should display if Steam has none | ❓ Unverified |
| Edit button within the review itself | ✅ Done |
| "Owned" should stay highlighted whether playing or completed | ❓ Unverified |

---

## 3. SEO + AI recommendations (May 2026 audit doc, priority table)

| Task | Spreadsheet priority | Status |
|---|---|---|
| Set up Google Search Console + submit sitemap | 🔴 High | 🚧 Sitemap exists and is cached (per buildlog), but GSC verification itself is an external dashboard step I can't confirm from the repo — check whether it's actually been submitted. |
| Add `AggregateRating` schema to game pages | 🔴 High | ✅ Done — present in `src/pages/games/[slug].astro`. |
| Fix game page title tags + meta descriptions | 🔴 High | ✅ Done — dynamic SEO tagging shipped May 13 ("added SEO related tagging and descriptions that populate dynamically based on slug, rating, game description etc."). |
| Build AI summary generation (Edge Function + webhook) | 🟡 Medium | 📋 Todo — not built. This is a genuinely new feature (Anthropic API call on review-threshold), not a bug fix; worth scoping as its own task if you want it. |
| Rewrite About page opening + add meta description | 🟡 Medium | 📋 Todo — About page exists but has no `description` prop passed to `Layout`. |
| Fix "reivew" typo on About page | 🟡 Medium | 📋 Todo — still present, confirmed at `src/pages/about.astro:45`. 5-minute fix. |
| Add display name field to decouple usernames from UI | 🟡 Medium | 📋 Todo — not built; `profiles` has no `display_name` column. |
| Add content reporting/flagging system | 🟢 Low | ✅ Done — the `reports` table + report UI existed before this session, and this session added an admin moderation queue (`/admin/reports`) on top of it. |
| Build out Rankings/Hot Takes with SEO-friendly titles | 🟢 Low | 🚧 Rankings and Hot Takes both exist as features; whether their titles/URLs are specifically SEO-optimized per the doc's suggestion (e.g. "Best RPGs of all time — Chekpoint community rankings") wasn't verified. |
| Internal game-to-game linking ("also reviewed by…") | 🟢 Low | ✅ Done — similar-games section exists on game pages, and the recommendations feature (built this session) goes further with "because you loved X" style suggestions. |

---

## 4. Near-term feature requests (Jun 10 & Jun 24 notes, Sam/Bill split)

Pulled from the two most recent "who's doing what" tables in Meeting Notes.

| Item | Owner | Status | Priority |
|---|---|---|---|
| Lists feature | Bill | ✅ Done — the entire ranked/unranked lists feature (Jun 14 – Jul 1) | — |
| Recommendations ("if you like X, play Y"; home page + profile tab) | Sam | ✅ Done — shipped Jul 2, iterated through Jul 3 (sidebar widget, empty state, carousel) | — |
| Emotes (~40 more) | Bill | ✅ Done — dozens of emotes added across May 26 – Jun 13 | — |
| Genre tags (glitchwave-style) | Bill | ❓ Unverified — no specific commit found referencing glitchwave-style genre tags | 🟢 Low |
| Consolidate multiple entries of the same game | — | 🚧 Partial — the search/category cleanup (categories, notable-edition detection) addresses *display* duplication; whether underlying duplicate DB rows get merged/consolidated wasn't confirmed. | 🟡 Medium |
| New-account welcome flow | Sam & Bill | ✅ Done — `/welcome` redesigned into a 3-step tutorial this session, plus a profile-completion nag banner (Jul 2) | — |
| Steam integration (import games) | Sam | ✅ Done, with a significant bug-hunt this session (matching, timeouts, duplicates) | — |
| Reviewer search + ranking polish | Sam | ❓ Unverified — "most recent reviewed game" + "total reviews" display on search cards not specifically confirmed | 🟢 Low |
| `game-statuses` update to work better with Steam import (recommend only if "completed") | Sam | ❓ Unverified | 🟡 Medium |
| New releases page (surface new IGDB additions) | Sam | 📋 Todo — not built | 🟢 Low |
| Profile nav restructure (letterboxd/backloggd style: profile, library, reviews, activity) | Sam | 🚧 Partial — profile reorg happened (Jun 11), but an explicit "activity" tab tied to the activity-feed branch above doesn't exist yet | 🟡 Medium |
| Groups: owners/admins pick featured games, schedule game nights, rate together | Sam | 🚧 Partial — group sessions exist; the "everyone rates together with a visible profile-pic breakdown" mechanic wasn't found | 🟡 Medium |
| Steam import fix (numbered sequels like X2/X3 not matching) | Sam | ✅ Done — this exact bug (Roman numerals, "&"/"and") was fixed and verified this session | — |
| Admin tool for unmatched Steam titles (`/admin/unmatched-games`) | — | ✅ Done — literally built this session, at the exact path requested in the notes | — |
| Admin page in general | — | ✅ Done — `/admin` hub + reports queue, gated to `site_admins` | — |
| Fix new-user profile tutorial to nag incomplete profiles | Sam | ✅ Done — shipped alongside the welcome-page rework | — |

---

## 5. Future ideas backlog (unprioritized — the "Ideas" and long-tail Meeting Notes brainstorms)

These were never assigned an owner or priority in the source material — captured here as a
reference list, not a commitment. Move anything up into the sections above once it's actually
scheduled.

- The Disagreement Feed (exists today as "Hot Takes" — may already satisfy this idea) -- hot takes does satisfy this feed
- User-curated ranked lists with a "fork into your own version" mechanic (Lists shipped; forking specifically wasn't built)
- A distinct "made me want to play this" reaction, separate from upvote/downvote
- Game "verdicts" — an AI-generated consensus summary per game (overlaps with the SEO doc's AI summary proposal in §3)
- "Blind score" mode — write your review before seeing the community average, reveal the delta after
- Recommendation request threads ("I just finished X and Y, what should I play next?")
- The "Sold Me On It" tag (a `SOLD` reaction already shipped — may partially cover this) -- ended up removing the sold tag
- Watchlists with notifications when a watched game gets reviewed
- Daily wordle/tradle-style guessing game using review stats as clues
- Soundtrack-snippet guessing game
- Bingo events (retro consoles, decade-themed, etc.)
- Backlog-clearing challenges
- Review streaks with Duolingo-style nudges
- A generated MBTI-style "reviewer personality" from your review history
- Badges/medals next to usernames, custom name banners, profile theming
- Direct messaging
- Sub-scores (soundtrack, gameplay, dev support, etc.) as a separate rating dimension
- Steam/Twitch/Discord/Battle.net account connections beyond the existing Steam sync
- Speedrun.com integration — verified-run-only reviews for speedrun categories
- Paid cosmetic backgrounds/skins (profile, app icon, site theme)
- Community-run "game of the year" / awards program
- Language filters / content moderation for non-English text
- Comment spam protection, CAPTCHA for signup bot prevention