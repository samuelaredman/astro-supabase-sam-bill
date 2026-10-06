-- The Stats tab games list's "Top rated" / "Lowest rated": one ranking for
-- both sides, rather than one per side.
--
-- group_versus_games plus three columns to order by:
-- - rated: the game's rating, to one decimal. A game both sides reviewed
--   rates at the average of the two; otherwise it's the one side's score.
--   The community's side uses its weighted average (other_weighted), so one
--   member's 10 doesn't outrank twenty 9s; a member's is their own score.
-- - rated_side: 0 for a game both sides reviewed, 1 for the subject's only,
--   2 for the other side's only.
-- - turn: a game's place among the games on its side at the same rating.
--
-- Ordered by rated, then turn, then rated_side, games at the same rating
-- alternate: both sides', the subject's, the other side's, then each side's
-- next. Callers .order() and .limit() it like group_versus_games; the window
-- runs over every game before PostgREST filters, which can leave gaps in
-- turn but never reorders a side.

CREATE OR REPLACE FUNCTION group_versus_games_ranked(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_prior_weight int DEFAULT 3
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  subject_score int,
  other_count int, other_avg float8, other_weighted float8,
  diff float8, diff_abs float8, pair_avg float8,
  rated float8, rated_side int, turn int
)
LANGUAGE sql STABLE AS $$
  WITH v AS (
    SELECT g.*,
           CASE WHEN g.other_count = 0 THEN NULL
                WHEN p_other_id IS NULL THEN g.other_weighted
                ELSE g.other_avg END AS other_rated
    FROM group_versus_games(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id, p_prior_weight) g
  ), r AS (
    SELECT v.*,
           round((CASE WHEN v.subject_score IS NOT NULL AND v.other_rated IS NOT NULL
                       THEN (v.subject_score + v.other_rated) / 2
                       ELSE coalesce(v.subject_score::float8, v.other_rated) END)::numeric, 1)::float8 AS rated,
           CASE WHEN v.subject_score IS NOT NULL AND v.other_rated IS NOT NULL THEN 0
                WHEN v.subject_score IS NOT NULL THEN 1
                ELSE 2 END AS rated_side
    FROM v
  )
  SELECT r.game_id, r.title, r.slug, r.cover_img_url,
         r.subject_score,
         r.other_count, r.other_avg, r.other_weighted,
         r.diff, r.diff_abs, r.pair_avg,
         r.rated, r.rated_side,
         (row_number() OVER (PARTITION BY r.rated_side, r.rated ORDER BY r.other_count DESC, r.title, r.game_id))::int
  FROM r;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_versus_games_ranked(uuid, uuid, uuid, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_versus_games_ranked(uuid, uuid, uuid, uuid, uuid, int) TO service_role;
