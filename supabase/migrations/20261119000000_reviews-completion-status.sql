-- Per-review completion status (DNF / Main Story / Platinum) plus a small
-- set of platinum-only metrics: hours to earn the plat, platinum difficulty,
-- and platinum enjoyment (the grind can diverge wildly from the game itself).
--
-- Review-wide `play_time_hours` and `difficulty` stay as whole-game signals.
-- `platinum_hours` / `platinum_difficulty` / `platinum_enjoyment` are only
-- meaningful when completion_status = 'platinum' and are CHECK-constrained
-- to NULL otherwise so stale plat metrics can't linger if a user downgrades
-- their status.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS completion_status text
    CHECK (completion_status IS NULL OR completion_status IN ('dnf', 'main', 'platinum'));

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS platinum_hours int
    CHECK (platinum_hours IS NULL OR platinum_hours >= 0);

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS platinum_difficulty smallint
    CHECK (platinum_difficulty IS NULL OR (platinum_difficulty BETWEEN 1 AND 10));

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS platinum_enjoyment smallint
    CHECK (platinum_enjoyment IS NULL OR (platinum_enjoyment BETWEEN 1 AND 10));

-- Plat-only fields must be NULL unless completion_status='platinum'.
-- Named so pg_constraint lookups are predictable.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_platinum_fields_require_platinum;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_platinum_fields_require_platinum
  CHECK (
    completion_status = 'platinum'
    OR (platinum_hours IS NULL AND platinum_difficulty IS NULL AND platinum_enjoyment IS NULL)
  );

CREATE OR REPLACE VIEW game_review_stats WITH (security_invoker = true) AS
SELECT
  game_id,
  count(*)::int                                               AS review_count,
  sum(score)::int                                             AS score_sum,
  sum(score)::float8 / count(*)                               AS avg_score,
  count(*) FILTER (WHERE play_time_hours > 0)::int            AS hours_count,
  coalesce(sum(play_time_hours) FILTER (WHERE play_time_hours > 0), 0)::int AS hours_sum,
  count(*) FILTER (WHERE difficulty IS NOT NULL)::int         AS difficulty_count,
  sum(difficulty) FILTER (WHERE difficulty IS NOT NULL)::int  AS difficulty_sum,
  CASE WHEN count(*) FILTER (WHERE difficulty IS NOT NULL) > 0
       THEN sum(difficulty)::float8 / count(*) FILTER (WHERE difficulty IS NOT NULL)
       ELSE NULL END                                          AS avg_difficulty,
  count(*) FILTER (WHERE completion_status = 'platinum')::int AS platinum_count,
  CASE WHEN count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_hours IS NOT NULL) > 0
       THEN sum(platinum_hours) FILTER (WHERE completion_status = 'platinum' AND platinum_hours IS NOT NULL)::float8
          / count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_hours IS NOT NULL)
       ELSE NULL END                                          AS avg_platinum_hours,
  CASE WHEN count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_difficulty IS NOT NULL) > 0
       THEN sum(platinum_difficulty) FILTER (WHERE completion_status = 'platinum' AND platinum_difficulty IS NOT NULL)::float8
          / count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_difficulty IS NOT NULL)
       ELSE NULL END                                          AS avg_platinum_difficulty,
  CASE WHEN count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_enjoyment IS NOT NULL) > 0
       THEN sum(platinum_enjoyment) FILTER (WHERE completion_status = 'platinum' AND platinum_enjoyment IS NOT NULL)::float8
          / count(*) FILTER (WHERE completion_status = 'platinum' AND platinum_enjoyment IS NOT NULL)
       ELSE NULL END                                          AS avg_platinum_enjoyment
FROM reviews
WHERE status = 'published'
GROUP BY game_id;
