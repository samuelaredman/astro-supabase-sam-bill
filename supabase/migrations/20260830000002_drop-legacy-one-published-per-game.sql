-- ─────────────────────────────────────────────────────────────────────────────
--  Phase 4 — drop the legacy "one published review per game" index.
--
--  reviews_one_published_per_game (a partial unique index: UNIQUE(profile_id,
--  game_id) WHERE status='published') is superseded by the per-revision index
--  added in 20260830000003, which permits a user to hold one published score per
--  game *revision* (dated score history).
--
--  A partial unique index cannot be a table constraint, so this is a plain
--  DROP INDEX — safe and idempotent. The application-level guard in
--  src/pages/api/reviews/create.ts (409 if a published review already exists for
--  the game) still prevents accidental duplicates during the window between this
--  drop and scripts/reconcile-reviews.ts --apply.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS reviews_one_published_per_game;
