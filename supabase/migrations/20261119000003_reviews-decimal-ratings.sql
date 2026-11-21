-- Allow one-decimal precision on the three 1–10 rating columns so reviewers
-- can enter 8.2 / 9.5 instead of being forced to round. Keeps the same 1–10
-- range CHECK constraints (they accept numeric just fine). numeric(3,1) is
-- precision=3 / scale=1, so it holds up to 99.9 with exactly one decimal.
--
-- game_review_stats references all three columns in its aggregates, so the
-- view has to be dropped before the type change and recreated after.

DROP VIEW IF EXISTS game_review_stats;

ALTER TABLE reviews
  ALTER COLUMN difficulty TYPE numeric(3,1) USING difficulty::numeric(3,1),
  ALTER COLUMN platinum_difficulty TYPE numeric(3,1) USING platinum_difficulty::numeric(3,1),
  ALTER COLUMN platinum_enjoyment TYPE numeric(3,1) USING platinum_enjoyment::numeric(3,1);

CREATE VIEW game_review_stats WITH (security_invoker = true) AS
SELECT
  game_id,
  count(*)::int                                               AS review_count,
  sum(score)::int                                             AS score_sum,
  sum(score)::float8 / count(*)                               AS avg_score,
  count(*) FILTER (WHERE play_time_hours > 0)::int            AS hours_count,
  coalesce(sum(play_time_hours) FILTER (WHERE play_time_hours > 0), 0)::int AS hours_sum,
  count(*) FILTER (WHERE difficulty IS NOT NULL)::int         AS difficulty_count,
  sum(difficulty) FILTER (WHERE difficulty IS NOT NULL)::numeric  AS difficulty_sum,
  CASE WHEN count(*) FILTER (WHERE difficulty IS NOT NULL) > 0
       THEN sum(difficulty) FILTER (WHERE difficulty IS NOT NULL)::float8
          / count(*) FILTER (WHERE difficulty IS NOT NULL)
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

  -- Platinum aggregates
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
