-- Per-review community difficulty rating (1–10). Nullable: a reviewer can
-- always skip it, and every review that predates this migration stays valid.
-- Aggregated in game_review_stats below so the game page sidebar shows an
-- average that only counts reviews which actually supplied a rating.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS difficulty smallint
    CHECK (difficulty IS NULL OR (difficulty BETWEEN 1 AND 10));

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
       ELSE NULL END                                          AS avg_difficulty
FROM reviews
WHERE status = 'published'
GROUP BY game_id;
