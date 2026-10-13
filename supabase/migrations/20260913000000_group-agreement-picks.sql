-- Agreement picks: games the group most agrees or disagrees on.
--
-- Requires at least p_min_reviews members reviewed the game (default 3): with
-- only two scores a single outlier fakes both signals. Variance is population
-- var_pop (we have every member's score, not a sample). Reads through
-- group_reviews() so genre/platform focus applies like the other stats.

CREATE OR REPLACE FUNCTION group_consensus_picks(
  p_group_id uuid,
  p_limit int DEFAULT 5,
  p_min_reviews int DEFAULT 3,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  review_count int, avg_score float8, min_score int, max_score int,
  score_variance float8
)
LANGUAGE sql STABLE AS $$
  WITH stats AS (
    SELECT r.game_id,
           count(*)::int AS review_count,
           avg(r.score)::float8 AS avg_score,
           min(r.score) AS min_score,
           max(r.score) AS max_score,
           coalesce(var_pop(r.score), 0)::float8 AS score_variance
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    GROUP BY r.game_id
    HAVING count(*) >= p_min_reviews
  )
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         s.review_count, s.avg_score, s.min_score, s.max_score, s.score_variance
  FROM stats s
  JOIN games g ON g.id = s.game_id
  ORDER BY s.score_variance ASC, s.review_count DESC, s.game_id
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION group_divergent_picks(
  p_group_id uuid,
  p_limit int DEFAULT 5,
  p_min_reviews int DEFAULT 3,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  review_count int, avg_score float8, min_score int, max_score int,
  score_variance float8
)
LANGUAGE sql STABLE AS $$
  WITH stats AS (
    SELECT r.game_id,
           count(*)::int AS review_count,
           avg(r.score)::float8 AS avg_score,
           min(r.score) AS min_score,
           max(r.score) AS max_score,
           coalesce(var_pop(r.score), 0)::float8 AS score_variance
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    GROUP BY r.game_id
    HAVING count(*) >= p_min_reviews
  )
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         s.review_count, s.avg_score, s.min_score, s.max_score, s.score_variance
  FROM stats s
  JOIN games g ON g.id = s.game_id
  ORDER BY s.score_variance DESC, s.review_count DESC, s.game_id
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION
  group_consensus_picks(uuid, int, int, uuid, uuid),
  group_divergent_picks(uuid, int, int, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_consensus_picks(uuid, int, int, uuid, uuid),
  group_divergent_picks(uuid, int, int, uuid, uuid)
TO service_role;
