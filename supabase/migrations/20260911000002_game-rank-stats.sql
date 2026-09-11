-- The game page's "#N all-time / in genre / in year" stats and the genre's
-- average score. The page used to page through every published review on the
-- site on every render, plus fetch every game in the genre and in the release
-- year (each capped at 1000 rows by Supabase, so large genres/years ranked
-- against a truncated set). One row back instead.
--
-- Semantics match the JS it replaces, with one deliberate fix:
--   * all-time rank is the 1-based position of the first game at or below this
--     game's average (0 when none is, i.e. an unreviewed game); genre/year rank
--     is 1 + the games above it; a NULL genre or year yields 0 for that rank
--     and total;
--   * the JS compared this game's *rounded* display average (8.35 shows as
--     "8.3") against every other game's exact average, so a game could rank
--     below games it actually beats. Both sides are exact here. Ranks can
--     differ from the old ones by one in those rare rounding cases.

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
      (SELECT avg_score FROM game_review_stats WHERE game_id = p_game_id), 0
    ) AS avg
  ),
  -- LEFT JOINs, not EXISTS in the select list: Postgres runs a select-list
  -- EXISTS once per reviewed game, where these become one hash join each.
  -- Both join keys are unique (game_genres PK, games PK), so no row multiplies;
  -- a NULL genre/year matches nothing.
  s AS (
    SELECT
      st.avg_score,
      st.review_count,
      st.score_sum,
      gg.game_id IS NOT NULL AS in_genre,
      g.id IS NOT NULL AS in_year
    FROM game_review_stats st
    LEFT JOIN game_genres gg
      ON gg.game_id = st.game_id AND gg.genre_id = p_genre_id
    LEFT JOIN games g
      ON g.id = st.game_id AND extract(year FROM g.date_released) = p_release_year
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

-- The game page's "similar games" grid shows Chekpoint scores for IGDB's
-- similar games, which arrive as slugs. One call resolves slug -> average (for
-- the ones that exist here and have reviews), instead of slug -> id and then a
-- second round trip for the averages on the page's slowest (IGDB) chain.
CREATE OR REPLACE FUNCTION game_scores_by_slug(p_slugs text[])
RETURNS TABLE(slug text, avg_score float8)
LANGUAGE sql STABLE AS $$
  SELECT g.slug, s.avg_score
  FROM games g
  CROSS JOIN LATERAL (
    SELECT v.avg_score FROM game_review_stats v WHERE v.game_id = g.id
  ) s
  WHERE g.slug = ANY(p_slugs);
$$;
