-- group_hot_take read the community side (every published review of a game)
-- straight from `reviews`. Site-wide per-game numbers are meant to come from
-- game_review_stats, so the planned swap of that view for a trigger-maintained
-- table (supabase/scaling/review-stats-as-tables.sql) covers this function too.
-- Same result: game_review_stats counts and averages the same published rows.
-- The group side still aggregates group_reviews() — no view covers it.

CREATE OR REPLACE FUNCTION group_hot_take(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, group_count int, group_avg float8, community_count int, community_avg float8)
LANGUAGE sql STABLE AS $$
  WITH g AS (
    SELECT game_id, count(*)::int AS n, avg(score)::float8 AS a
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
    GROUP BY game_id
  )
  SELECT g.game_id, g.n, g.a, c.review_count, c.avg_score
  FROM g
  -- LATERAL, not a join on the whole view: per-game equality lets Postgres push
  -- the filter into the view and use the reviews.game_id index
  CROSS JOIN LATERAL (
    SELECT s.review_count, s.avg_score FROM game_review_stats s WHERE s.game_id = g.game_id
  ) c
  WHERE c.review_count >= 3
    AND round(g.a::numeric, 1) <> round(c.avg_score::numeric, 1)
  ORDER BY (g.n >= 2) DESC, abs(g.a - c.avg_score) DESC, g.game_id
  LIMIT 1;
$$;

-- CREATE OR REPLACE keeps the existing grants (service_role only, 20260911120000).
