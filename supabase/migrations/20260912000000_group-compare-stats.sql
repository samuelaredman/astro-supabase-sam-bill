-- Stats tab: group averages, and comparing chosen members against each other
-- and against the group.
--
-- The tab used to list the 30 most-reviewed games with every member's score
-- badge and nothing to read them against — no group average anywhere on the
-- page, no way to line yourself up next to the creator. These functions answer
-- "how does this handful of people score, vs each other and vs the group",
-- with the member set passed in so the work stays in Postgres.
--
-- Like the other group_* functions, everything reads through group_reviews(),
-- so "published, by a current member, inside the group's focus" stays defined
-- in exactly one place.

-- Score distribution for the 1-10 histogram. One set for the whole group
-- (profile_id NULL) plus one per profile in p_profile_ids, so the tab's
-- histogram and each member's shape come from a single round trip.
CREATE OR REPLACE FUNCTION group_score_distribution(
  p_group_id uuid,
  p_profile_ids uuid[] DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(profile_id uuid, score int, review_count int)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.profile_id, r.score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  )
  SELECT NULL::uuid, gr.score, count(*)::int
  FROM gr GROUP BY gr.score
  UNION ALL
  -- = ANY('{}') matches nothing, so a NULL p_profile_ids yields the group row only
  SELECT gr.profile_id, gr.score, count(*)::int
  FROM gr
  WHERE gr.profile_id = ANY (coalesce(p_profile_ids, '{}'::uuid[]))
  GROUP BY gr.profile_id, gr.score;
$$;

-- One row per chosen member: their own totals, plus how they sit against the
-- group's average on the same games. The vs_group_* columns only count games
-- another member also reviewed (group_count > 1) — on a game only they have
-- reviewed, the group average IS their score, so the gap is always 0 and
-- counting it would drag every member's average difference toward nothing.
CREATE OR REPLACE FUNCTION group_compare_member_stats(
  p_group_id uuid,
  p_profile_ids uuid[],
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  profile_id uuid,
  review_count int,
  avg_score float8,
  hours_sum int,
  vs_group_games int,
  vs_group_abs_diff float8,
  vs_group_above int,
  vs_group_below int,
  vs_group_level int
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.profile_id, r.game_id, r.score, r.play_time_hours
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  ), game_avg AS (
    SELECT gr.game_id, avg(gr.score)::float8 AS avg_score, count(*)::int AS n
    FROM gr GROUP BY gr.game_id
  )
  SELECT s.profile_id,
         count(*)::int,
         avg(s.score)::float8,
         coalesce(sum(s.play_time_hours), 0)::int,
         count(*) FILTER (WHERE ga.n > 1)::int,
         avg(abs(s.score - ga.avg_score)) FILTER (WHERE ga.n > 1)::float8,
         count(*) FILTER (WHERE ga.n > 1 AND round(s.score::numeric, 1) > round(ga.avg_score::numeric, 1))::int,
         count(*) FILTER (WHERE ga.n > 1 AND round(s.score::numeric, 1) < round(ga.avg_score::numeric, 1))::int,
         count(*) FILTER (WHERE ga.n > 1 AND round(s.score::numeric, 1) = round(ga.avg_score::numeric, 1))::int
  FROM gr s
  JOIN game_avg ga ON ga.game_id = s.game_id
  WHERE s.profile_id = ANY (p_profile_ids)
  GROUP BY s.profile_id;
$$;

-- One row per game at least one chosen member reviewed: the group's numbers and
-- the chosen members' numbers side by side. sel_vs_group_abs is returned as its
-- own column so a caller can .order() by distance from the group average —
-- PostgREST can order by a column but not by abs() of one.
CREATE OR REPLACE FUNCTION group_compare_games(
  p_group_id uuid,
  p_profile_ids uuid[],
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  group_count int, group_avg float8,
  sel_count int, sel_avg float8, sel_spread int,
  sel_vs_group float8, sel_vs_group_abs float8
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.game_id, r.profile_id, r.score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  ), agg AS (
    SELECT gr.game_id,
           count(*)::int AS group_count,
           avg(gr.score)::float8 AS group_avg,
           count(*) FILTER (WHERE gr.profile_id = ANY (p_profile_ids))::int AS sel_count,
           avg(gr.score) FILTER (WHERE gr.profile_id = ANY (p_profile_ids))::float8 AS sel_avg,
           coalesce(
             max(gr.score) FILTER (WHERE gr.profile_id = ANY (p_profile_ids))
             - min(gr.score) FILTER (WHERE gr.profile_id = ANY (p_profile_ids)),
             0)::int AS sel_spread
    FROM gr
    GROUP BY gr.game_id
  )
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         a.group_count, a.group_avg, a.sel_count, a.sel_avg, a.sel_spread,
         (a.sel_avg - a.group_avg)::float8,
         abs(a.sel_avg - a.group_avg)::float8
  FROM agg a
  JOIN games g ON g.id = a.game_id
  WHERE a.sel_count > 0;
$$;

-- The chosen members' individual scores on the games the tab is showing, for
-- the per-game score lines. Bounded by (games shown x members chosen), unlike
-- group_game_member_scores which returns every member's score on those games.
CREATE OR REPLACE FUNCTION group_compare_scores(
  p_group_id uuid,
  p_profile_ids uuid[],
  p_game_ids uuid[]
)
RETURNS TABLE(game_id uuid, profile_id uuid, score int)
LANGUAGE sql STABLE AS $$
  SELECT r.game_id, r.profile_id, r.score
  FROM group_reviews(p_group_id) r
  WHERE r.game_id = ANY (p_game_ids)
    AND r.profile_id = ANY (p_profile_ids);
$$;

-- How closely each pair of chosen members agrees, over the games both reviewed.
-- a_profile_id < b_profile_id returns each unordered pair once.
CREATE OR REPLACE FUNCTION group_compare_pairs(
  p_group_id uuid,
  p_profile_ids uuid[],
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  a_profile_id uuid, b_profile_id uuid,
  shared_games int, mean_abs_diff float8,
  exact_matches int, within_one int,
  a_higher int, b_higher int
)
LANGUAGE sql STABLE AS $$
  WITH sel AS (
    SELECT r.profile_id, r.game_id, r.score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    WHERE r.profile_id = ANY (p_profile_ids)
  )
  SELECT a.profile_id, b.profile_id,
         count(*)::int,
         avg(abs(a.score - b.score))::float8,
         count(*) FILTER (WHERE a.score = b.score)::int,
         count(*) FILTER (WHERE abs(a.score - b.score) <= 1)::int,
         count(*) FILTER (WHERE a.score > b.score)::int,
         count(*) FILTER (WHERE b.score > a.score)::int
  FROM sel a
  JOIN sel b ON b.game_id = a.game_id AND a.profile_id < b.profile_id
  GROUP BY a.profile_id, b.profile_id;
$$;

-- Server-only, like the rest of the review stats: the pages call these with the
-- service-role client.
REVOKE EXECUTE ON FUNCTION
  group_score_distribution(uuid, uuid[], uuid, uuid),
  group_compare_member_stats(uuid, uuid[], uuid, uuid),
  group_compare_games(uuid, uuid[], uuid, uuid),
  group_compare_scores(uuid, uuid[], uuid[]),
  group_compare_pairs(uuid, uuid[], uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_score_distribution(uuid, uuid[], uuid, uuid),
  group_compare_member_stats(uuid, uuid[], uuid, uuid),
  group_compare_games(uuid, uuid[], uuid, uuid),
  group_compare_scores(uuid, uuid[], uuid[]),
  group_compare_pairs(uuid, uuid[], uuid, uuid)
TO service_role;
