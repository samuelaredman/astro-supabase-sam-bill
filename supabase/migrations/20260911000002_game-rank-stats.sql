-- The game page's "#N all-time / in genre / in year" stats and the genre's
-- average score. The page used to page through every published review on the
-- site on every render, plus fetch every game in the genre and in the release
-- year (each capped at 1000 rows by Supabase, so large genres/years ranked
-- against a truncated set). One row back instead.
--
-- Semantics match the JS it replaces:
--   * "this game's average" is the displayed one — rounded to one decimal, or
--     0 when the game has no reviews;
--   * all-time rank is the 1-based position of the first game at or below that
--     average (0 when none is); genre/year rank is 1 + the games above it;
--   * a NULL genre or year yields 0 for that rank and total.

CREATE OR REPLACE FUNCTION game_rank_stats(
  p_game_id      uuid,
  p_genre_id     uuid,
  p_release_year int
)
RETURNS TABLE(
  all_time_rank   int,
  all_time_total  int,
  genre_rank      int,
  genre_total     int,
  genre_avg_score float8,
  year_rank       int,
  year_total      int
) LANGUAGE sql STABLE AS $$
  WITH this AS (
    SELECT coalesce(
      (SELECT round(score_sum::numeric / review_count, 1) FROM game_review_stats WHERE game_id = p_game_id),
      0
    )::float8 AS avg
  ),
  s AS (
    SELECT
      st.avg_score,
      st.review_count,
      st.score_sum,
      p_genre_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM game_genres gg WHERE gg.game_id = st.game_id AND gg.genre_id = p_genre_id
      ) AS in_genre,
      p_release_year IS NOT NULL AND EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = st.game_id AND extract(year FROM g.date_released) = p_release_year
      ) AS in_year
    FROM game_review_stats st
  )
  SELECT
    CASE WHEN count(*) FILTER (WHERE s.avg_score <= this.avg) > 0
         THEN (count(*) FILTER (WHERE s.avg_score > this.avg) + 1)::int
         ELSE 0 END,
    count(*)::int,
    CASE WHEN p_genre_id IS NULL THEN 0
         ELSE (count(*) FILTER (WHERE s.in_genre AND s.avg_score > this.avg) + 1)::int END,
    count(*) FILTER (WHERE s.in_genre)::int,
    coalesce(round(
      sum(s.score_sum) FILTER (WHERE s.in_genre)::numeric
        / nullif(sum(s.review_count) FILTER (WHERE s.in_genre), 0),
      1), 0)::float8,
    CASE WHEN p_release_year IS NULL THEN 0
         ELSE (count(*) FILTER (WHERE s.in_year AND s.avg_score > this.avg) + 1)::int END,
    count(*) FILTER (WHERE s.in_year)::int
  FROM s CROSS JOIN this
  GROUP BY this.avg;
$$;
