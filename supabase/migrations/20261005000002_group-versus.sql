-- Stats tab, redesigned as "you vs someone": one member against either the
-- rest of the group (the community) or one other member.
--
-- Generalises group_compare_community_games/_summary (migration
-- 20260912000002) with p_other_id: NULL compares against every other member,
-- exactly as before, and a member id compares against just that member. The
-- subject's own reviews are never on the other side.
--
-- Like the other group_* functions, everything reads through group_reviews(),
-- so "published, by a current member, inside the group's focus" stays defined
-- in exactly one place.

-- One row per game the subject or the other side reviewed. Callers .order()
-- and .limit() it for each list, which is why diff_abs, pair_avg and
-- other_weighted are columns: PostgREST can order by a column but not by an
-- expression.
--
-- other_weighted is a Bayesian average pulled towards the other side's overall
-- mean by p_prior_weight phantom reviews, so a game two members gave a 10
-- doesn't outrank one twenty members averaged 9.4 at. Against one member every
-- game has one review, so it orders the same as their score.
CREATE OR REPLACE FUNCTION group_versus_games(
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
           max(gr.score) FILTER (WHERE gr.profile_id = p_profile_id)::int AS subject_score,
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

-- The headline numbers: over games the subject reviewed and the other side
-- reviewed at least p_min_reviews times, how far apart they are. Both averages
-- are over those same games, so the two are like for like. Always one row;
-- shared_games is 0 when there is nothing to compare.
CREATE OR REPLACE FUNCTION group_versus_summary(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_min_reviews int DEFAULT 1
)
RETURNS TABLE(
  shared_games int,
  subject_avg float8,
  other_avg float8,
  mean_abs_diff float8,
  within_one int,
  above int,
  below int,
  level int
)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int,
         avg(v.subject_score)::float8,
         avg(v.other_avg)::float8,
         avg(v.diff_abs)::float8,
         count(*) FILTER (WHERE v.diff_abs <= 1)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) > 0)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) < 0)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) = 0)::int
  FROM group_versus_games(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id) v
  WHERE v.subject_score IS NOT NULL
    AND v.other_count >= p_min_reviews;
$$;

-- Server-only, like the rest of the review stats: the pages call these with the
-- service-role client.
REVOKE EXECUTE ON FUNCTION
  group_versus_games(uuid, uuid, uuid, uuid, uuid, int),
  group_versus_summary(uuid, uuid, uuid, uuid, uuid, int)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_versus_games(uuid, uuid, uuid, uuid, uuid, int),
  group_versus_summary(uuid, uuid, uuid, uuid, uuid, int)
TO service_role;
