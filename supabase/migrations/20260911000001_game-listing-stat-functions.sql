-- Ranked game/studio lists for /rankings, /discover (fallback grid) and /search
-- (browse grid + studio tab). Each used to read every published review — or all
-- of game_companies — and rank in JS, which was capped at 1000 rows by
-- Supabase. Ranking here returns only the rows that get rendered.

-- /rankings: Bayesian average — each game's scores blended with p_prior_weight
-- phantom reviews at the site-wide mean, so a single 10/10 can't top the chart.
CREATE OR REPLACE FUNCTION ranked_games(
  p_limit        int DEFAULT 100,
  p_min_reviews  int DEFAULT 2,
  p_prior_weight int DEFAULT 5
)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8, bayesian_score float8)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM game_review_stats),
  m AS (
    SELECT coalesce(sum(score_sum)::float8 / nullif(sum(review_count), 0), 7) AS mean FROM s
  )
  SELECT
    s.game_id,
    s.review_count,
    s.avg_score,
    (p_prior_weight * m.mean + s.score_sum) / (p_prior_weight + s.review_count) AS bayesian_score
  FROM s CROSS JOIN m
  WHERE s.review_count >= p_min_reviews
  ORDER BY bayesian_score DESC, s.game_id
  LIMIT p_limit;
$$;

-- /rankings sidebar: total published reviews and the site-wide mean score.
CREATE OR REPLACE FUNCTION review_score_summary()
RETURNS TABLE(review_count int, avg_score float8)
LANGUAGE sql STABLE AS $$
  SELECT
    coalesce(sum(review_count), 0)::int,
    sum(score_sum)::float8 / nullif(sum(review_count), 0)
  FROM game_review_stats;
$$;

-- /search browse grid (optionally within one genre and/or platform) and the
-- /discover fallback (games the viewer hasn't reviewed yet). Starts from the
-- reviewed games and probes the junction PKs, so cost tracks reviews, not the
-- size of the game catalogue.
CREATE OR REPLACE FUNCTION most_reviewed_games(
  p_limit              int  DEFAULT 48,
  p_genre_id           uuid DEFAULT NULL,
  p_platform_id        uuid DEFAULT NULL,
  p_exclude_profile_id uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8)
LANGUAGE sql STABLE AS $$
  SELECT s.game_id, s.review_count, s.avg_score
  FROM game_review_stats s
  WHERE (p_genre_id IS NULL OR EXISTS (
          SELECT 1 FROM game_genres gg WHERE gg.game_id = s.game_id AND gg.genre_id = p_genre_id))
    AND (p_platform_id IS NULL OR EXISTS (
          SELECT 1 FROM game_platforms gp WHERE gp.game_id = s.game_id AND gp.platform_id = p_platform_id))
    AND (p_exclude_profile_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.game_id = s.game_id AND r.profile_id = p_exclude_profile_id AND r.status = 'published'))
  ORDER BY s.review_count DESC, s.game_id
  LIMIT p_limit;
$$;

-- /search studio tab: developers ranked by how many of their games have at
-- least one published review.
CREATE OR REPLACE FUNCTION top_studios_by_reviewed_games(p_limit int DEFAULT 24)
RETURNS TABLE(id uuid, name text, slug text, reviewed_game_count int)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.name, d.slug, count(*)::int AS reviewed_game_count
  FROM game_review_stats s
  JOIN game_companies gc ON gc.game_id = s.game_id AND gc.role = 'developer'
  JOIN developers d ON d.id = gc.company_id
  GROUP BY d.id, d.name, d.slug
  ORDER BY reviewed_game_count DESC, d.name
  LIMIT p_limit;
$$;
