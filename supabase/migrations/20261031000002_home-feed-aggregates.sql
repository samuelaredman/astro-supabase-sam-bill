-- Home-feed aggregates: trending-games and hot-takes.
--
-- Both previously fetched up to 500 review rows into the Astro frontmatter and
-- aggregated in JS (src/pages/index.astro). The trending list is a top-5, the
-- hot-takes list is a top-30 — pushing the aggregation into Postgres cuts the
-- payload by ~495 and ~470 rows and keeps correctness past the 1000-row cap.
--
-- Both functions are service-role only (same pattern as the review-stats
-- functions in 20260911000005): CLAUDE.md requires the admin client for all
-- DB reads, and these aggregate over published reviews.

-- Top-N games by review count since p_since. Reads from reviews directly:
-- game_review_stats is cumulative and cannot answer "last 7 days".
CREATE OR REPLACE FUNCTION home_trending_games(
  p_since timestamptz,
  p_limit int DEFAULT 5
)
RETURNS TABLE(
  game_id uuid,
  title text,
  slug text,
  cover_img_url text,
  review_count int
)
LANGUAGE sql STABLE AS $$
  SELECT
    r.game_id,
    g.title,
    g.slug,
    g.cover_img_url,
    count(*)::int AS review_count
  FROM reviews r
  JOIN games g ON g.id = r.game_id
  WHERE r.status = 'published'
    AND r.published_at >= p_since
  GROUP BY r.game_id, g.title, g.slug, g.cover_img_url
  ORDER BY review_count DESC, g.title
  LIMIT p_limit;
$$;

-- Newest published reviews whose score deviates from the game's community
-- average by at least p_min_deviation. The average comes from game_review_stats
-- (all-time, authoritative) rather than a windowed JS average; p_min_reviews
-- gates games with too few reviews to have a meaningful consensus. Returns the
-- game's avg + count alongside each review so the hot-takes card can render
-- "avg <x> across <n> reviews" without a second lookup.
CREATE OR REPLACE FUNCTION home_hot_takes(
  p_limit int DEFAULT 30,
  p_min_deviation numeric DEFAULT 2.5,
  p_min_reviews int DEFAULT 2
)
RETURNS TABLE(id uuid, game_avg_score float8, game_review_count int)
LANGUAGE sql STABLE AS $$
  SELECT r.id, s.avg_score, s.review_count
  FROM reviews r
  JOIN game_review_stats s ON s.game_id = r.game_id
  WHERE r.status = 'published'
    AND s.review_count >= p_min_reviews
    AND abs(r.score::numeric - s.avg_score::numeric) >= p_min_deviation
  ORDER BY coalesce(r.published_at, r.created_at) DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION
  home_trending_games(timestamptz, int),
  home_hot_takes(int, numeric, int)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  home_trending_games(timestamptz, int),
  home_hot_takes(int, numeric, int)
TO service_role;
