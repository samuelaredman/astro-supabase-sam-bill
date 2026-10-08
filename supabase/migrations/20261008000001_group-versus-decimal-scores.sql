-- The Stats tab showed a member's own score rounded to a whole number:
-- group_versus_games returned subject_score as int, so a 9.3 came back as 9,
-- and every gap and average built on it (diff, the summary's averages, the
-- "agree"/"disagree" scopes, the ranked list's rating) was off by up to half
-- a point. Scores have one decimal everywhere else on the site; this returns
-- the real one.
--
-- Changing a return column's type needs a DROP, so both functions that
-- return subject_score are dropped and recreated (bodies unchanged apart from
-- the type), then granted again. Their callers (group_versus_scope,
-- group_versus_summary) read the column by name and need no change.

DROP FUNCTION IF EXISTS group_versus_games_ranked(uuid, uuid, uuid, uuid, uuid, int);
DROP FUNCTION IF EXISTS group_versus_games(uuid, uuid, uuid, uuid, uuid, int);

CREATE FUNCTION group_versus_games(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_prior_weight int DEFAULT 3
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  subject_score float8,
  other_count int, other_avg float8, other_weighted float8,
  diff float8, diff_abs float8, pair_avg float8
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.game_id, r.profile_id, r.score,
           CASE WHEN p_other_id IS NULL THEN r.profile_id <> p_profile_id
                ELSE r.profile_id = p_other_id END AS is_other
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    WHERE p_other_id IS NULL OR r.profile_id IN (p_profile_id, p_other_id)
  ), prior AS (
    SELECT coalesce(avg(gr.score) FILTER (WHERE gr.is_other), 0)::float8 AS mean FROM gr
  ), agg AS (
    SELECT gr.game_id,
           max(gr.score) FILTER (WHERE gr.profile_id = p_profile_id)::float8 AS subject_score,
           count(*) FILTER (WHERE gr.is_other)::int AS other_count,
           avg(gr.score) FILTER (WHERE gr.is_other)::float8 AS other_avg,
           coalesce(sum(gr.score) FILTER (WHERE gr.is_other), 0)::float8 AS other_sum
    FROM gr
    GROUP BY gr.game_id
  )
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         a.subject_score,
         a.other_count,
         a.other_avg,
         CASE WHEN a.other_count > 0
              THEN (a.other_sum + p_prior_weight * p.mean) / (a.other_count + p_prior_weight)
         END::float8,
         (a.subject_score - a.other_avg)::float8,
         abs(a.subject_score - a.other_avg)::float8,
         ((a.subject_score + a.other_avg) / 2)::float8
  FROM agg a
  CROSS JOIN prior p
  JOIN games g ON g.id = a.game_id;
$$;

CREATE FUNCTION group_versus_games_ranked(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_prior_weight int DEFAULT 3
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  subject_score float8,
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
                       ELSE coalesce(v.subject_score, v.other_rated) END)::numeric, 1)::float8 AS rated,
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
REVOKE EXECUTE ON FUNCTION
  group_versus_games(uuid, uuid, uuid, uuid, uuid, int),
  group_versus_games_ranked(uuid, uuid, uuid, uuid, uuid, int)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  group_versus_games(uuid, uuid, uuid, uuid, uuid, int),
  group_versus_games_ranked(uuid, uuid, uuid, uuid, uuid, int)
TO service_role;
