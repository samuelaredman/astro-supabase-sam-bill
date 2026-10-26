-- ─────────────────────────────────────────────────────────────────────────────
--  Phase 4 — one published review per (user, game, revision).
--
--  Replaces reviews_one_published_per_game (dropped in 20260830000002). Dated
--  score history: a user may hold one published score per game *revision*, so a
--  launch score and a post-DLC/edition score coexist as distinct rows.
--
--  Scoped to `revision_id IS NOT NULL` so it never mis-fires on legacy published
--  rows before scripts/reconcile-reviews.ts stamps them with a revision, and so
--  draft rows (revision_id NULL) never participate.
--
--  Apply order (see scripts/reconcile-reviews.ts header — snapshot `reviews`
--  first): drop 20260830000002 → run reconcile --apply → apply this. Applying all
--  three then running reconcile is also safe (this predicate ignores the
--  not-yet-stamped rows until reconcile fills revision_id).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_published_per_revision
  ON reviews (profile_id, game_id, revision_id)
  WHERE status = 'published' AND revision_id IS NOT NULL;
