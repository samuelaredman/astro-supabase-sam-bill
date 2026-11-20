-- Hours to reach the selected completion tier. Only meaningful for the two
-- non-platinum status values that have a notion of "beat the game" without
-- 100% ing it — 'main' (main story) and 'extras' (main + post game). Platinum
-- keeps its own `platinum_hours` column so plat-specific aggregates stay
-- distinct from "beat the main story" time.
--
-- Review-wide `play_time_hours` is unchanged and still represents total time
-- played, which may be more or less than completion_hours depending on how
-- the reviewer logs it.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS completion_hours int
    CHECK (completion_hours IS NULL OR completion_hours >= 0);

-- Only allow a non-null completion_hours when the row is in a status that
-- makes sense for it. Keeps stale values from lingering if a reviewer
-- downgrades their status to DNF or null.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_completion_hours_requires_status;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_completion_hours_requires_status
  CHECK (
    completion_hours IS NULL
    OR completion_status IN ('main', 'extras')
  );

-- CREATE OR REPLACE VIEW can't reorder columns in an existing view; the new
-- main/extras aggregates slot between difficulty_* and platinum_*, so drop
-- and recreate. Nothing SQL-side depends on this view — it's read directly
-- by the Astro app via the Supabase client.
DROP VIEW IF EXISTS game_review_stats;
CREATE VIEW game_review_stats WITH (security_invoker = true) AS
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

  -- Main story breakdown (status='main' with a completion_hours supplied)
  count(*) FILTER (WHERE completion_status = 'main' AND completion_hours IS NOT NULL)::int
                                                              AS main_hours_count,
  CASE WHEN count(*) FILTER (WHERE completion_status = 'main' AND completion_hours IS NOT NULL) > 0
       THEN sum(completion_hours) FILTER (WHERE completion_status = 'main' AND completion_hours IS NOT NULL)::float8
          / count(*) FILTER (WHERE completion_status = 'main' AND completion_hours IS NOT NULL)
       ELSE NULL END                                          AS avg_main_hours,

  -- Main + extras breakdown (status='extras' with a completion_hours supplied)
  count(*) FILTER (WHERE completion_status = 'extras' AND completion_hours IS NOT NULL)::int
                                                              AS extras_hours_count,
  CASE WHEN count(*) FILTER (WHERE completion_status = 'extras' AND completion_hours IS NOT NULL) > 0
       THEN sum(completion_hours) FILTER (WHERE completion_status = 'extras' AND completion_hours IS NOT NULL)::float8
          / count(*) FILTER (WHERE completion_status = 'extras' AND completion_hours IS NOT NULL)
       ELSE NULL END                                          AS avg_extras_hours,

  -- Platinum aggregates (unchanged from prior migration)
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
