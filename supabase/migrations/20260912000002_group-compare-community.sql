-- Stats tab: one member (the creator, by default) against the rest of the group.
--
-- The existing vs_group_* numbers measure a member against a group average that
-- includes their own score, which is fine for a small friend group but reads
-- wrong for "me vs my community": on a game eight people reviewed, the creator's
-- own 10 is part of the average they are being compared with. Everything here
-- takes the subject out of the community side.
--
-- Like the other group_* functions, everything reads through group_reviews(),
-- so "published, by a current member, inside the group's focus" stays defined
-- in exactly one place.

-- One row per game the subject or anyone else in the group reviewed: the
-- community's numbers without the subject, and the subject's own score beside
-- them. Callers .order()/.limit() it for each list, which is why diff_abs and
-- community_weighted are columns: PostgREST can order by a column but not by an
-- expression.
--
-- community_weighted is a Bayesian average pulled towards the community's
-- overall mean by p_prior_weight phantom reviews, so a game two members gave a
-- 10 doesn't outrank one twenty members averaged 9.4 at.
CREATE OR REPLACE FUNCTION group_compare_community_games(
  p_group_id uuid,
  p_profile_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_prior_weight int DEFAULT 3
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  community_count int, community_avg float8, community_weighted float8,
  subject_score int, diff float8, diff_abs float8
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.game_id, r.profile_id, r.score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  ), prior AS (
    SELECT coalesce(avg(gr.score), 0)::float8 AS mean
    FROM gr WHERE gr.profile_id <> p_profile_id
  ), agg AS (
    SELECT gr.game_id,
           count(*) FILTER (WHERE gr.profile_id <> p_profile_id)::int AS community_count,
           avg(gr.score) FILTER (WHERE gr.profile_id <> p_profile_id)::float8 AS community_avg,
           coalesce(sum(gr.score) FILTER (WHERE gr.profile_id <> p_profile_id), 0)::float8 AS community_sum,
           max(gr.score) FILTER (WHERE gr.profile_id = p_profile_id)::int AS subject_score
    FROM gr
    GROUP BY gr.game_id
  )
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         a.community_count,
         a.community_avg,
         CASE WHEN a.community_count > 0
              THEN (a.community_sum + p_prior_weight * p.mean) / (a.community_count + p_prior_weight)
         END::float8,
         a.subject_score,
         (a.subject_score - a.community_avg)::float8,
         abs(a.subject_score - a.community_avg)::float8
  FROM agg a
  CROSS JOIN prior p
  JOIN games g ON g.id = a.game_id;
$$;

-- The headline numbers: over games the subject reviewed and at least
-- p_min_reviews other members reviewed, how far apart they are. subject_avg and
-- community_avg are both over those same games, so the two are like for like.
-- Always one row; shared_games is 0 when there is nothing to compare.
CREATE OR REPLACE FUNCTION group_compare_community_summary(
  p_group_id uuid,
  p_profile_id uuid,
  p_min_reviews int DEFAULT 2,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  shared_games int,
  subject_avg float8,
  community_avg float8,
  mean_abs_diff float8,
  within_one int,
  above int,
  below int,
  level int
)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int,
         avg(c.subject_score)::float8,
         avg(c.community_avg)::float8,
         avg(c.diff_abs)::float8,
         count(*) FILTER (WHERE c.diff_abs <= 1)::int,
         count(*) FILTER (WHERE round(c.diff::numeric, 1) > 0)::int,
         count(*) FILTER (WHERE round(c.diff::numeric, 1) < 0)::int,
         count(*) FILTER (WHERE round(c.diff::numeric, 1) = 0)::int
  FROM group_compare_community_games(p_group_id, p_profile_id, p_genre_id, p_platform_id) c
  WHERE c.subject_score IS NOT NULL
    AND c.community_count >= p_min_reviews;
$$;

-- Server-only, like the rest of the review stats: the pages call these with the
-- service-role client.
REVOKE EXECUTE ON FUNCTION
  group_compare_community_games(uuid, uuid, uuid, uuid, int),
  group_compare_community_summary(uuid, uuid, int, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_compare_community_games(uuid, uuid, uuid, uuid, int),
  group_compare_community_summary(uuid, uuid, int, uuid, uuid)
TO service_role;
