-- More for the Games tab's stats section to show: a few members who played,
-- finished and 100%'d each game (for the avatars under each stage), and how
-- many members gave it each score from 1 to 10 (the rating breakdown).
-- Everything else in group_featured_game_stats() is unchanged from migration
-- 20261007000000.
--
-- The return type changes, so the function is dropped and recreated.

DROP FUNCTION IF EXISTS group_featured_game_stats(uuid, uuid[]);

CREATE OR REPLACE FUNCTION group_featured_game_stats(
  p_group_id uuid,
  p_game_ids uuid[]
)
RETURNS TABLE(
  game_id uuid,
  member_count int,
  played_count int,
  completed_count int,
  full_count int,
  review_count int,
  avg_score float8,
  achievement_count int,
  avg_achievement_pct float8,
  hours_count int,
  avg_hours float8,
  completed_hours_count int,
  avg_completed_hours float8,
  full_hours_count int,
  avg_full_hours float8,
  full_profile_ids uuid[],
  completed_profile_ids uuid[],
  played_profile_ids uuid[],
  score_counts int[]
)
LANGUAGE sql STABLE AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_game_ids) AS game_id
  ), members AS (
    SELECT gm.profile_id,
           p.library_visibility = 'public' AS lib_public,
           p.library_show_hours AS show_hours
    FROM group_members gm
    JOIN profiles p ON p.id = gm.profile_id
    WHERE gm.group_id = p_group_id
  ), rev AS (
    SELECT r.profile_id, r.game_id, r.score, nullif(r.play_time_hours, 0)::float8 AS hours
    FROM group_reviews(p_group_id, NULL, NULL) r
    WHERE r.game_id = ANY(p_game_ids)
  ), lib AS (
    SELECT u.profile_id, u.game_id, u.status,
           CASE WHEN m.show_hours
                THEN nullif(greatest(coalesce(u.steam_playtime_minutes, 0), coalesce(u.psn_playtime_minutes, 0)), 0) / 60.0
           END::float8 AS hours
    FROM user_game_status u
    JOIN members m ON m.profile_id = u.profile_id
    WHERE u.game_id = ANY(p_game_ids)
      AND m.lib_public
      AND NOT u.is_hidden
  ), ach_rows AS (
    SELECT a.profile_id, a.game_id,
           (count(*) FILTER (WHERE a.unlocked))::float8 / count(*) AS pct,
           false AS platinum
    FROM user_achievements a
    WHERE a.game_id = ANY(p_game_ids)
    GROUP BY a.profile_id, a.game_id
    UNION ALL
    SELECT t.profile_id, t.game_id,
           (count(*) FILTER (WHERE t.earned))::float8 / count(*),
           bool_or(t.earned AND t.trophy_type = 'platinum')
    FROM user_trophies t
    WHERE t.game_id = ANY(p_game_ids)
    GROUP BY t.profile_id, t.game_id
    UNION ALL
    SELECT x.profile_id, x.game_id,
           (count(*) FILTER (WHERE x.unlocked))::float8 / count(*),
           false
    FROM user_xbox_achievements x
    WHERE x.game_id = ANY(p_game_ids)
    GROUP BY x.profile_id, x.game_id
  ), ach AS (
    SELECT ar.profile_id, ar.game_id, max(ar.pct) AS pct, bool_or(ar.platinum) AS platinum
    FROM ach_rows ar
    JOIN members m ON m.profile_id = ar.profile_id AND m.lib_public
    WHERE NOT EXISTS (
      SELECT 1 FROM user_game_status h
      WHERE h.profile_id = ar.profile_id AND h.game_id = ar.game_id AND h.is_hidden
    )
    GROUP BY ar.profile_id, ar.game_id
  ), people AS (
    SELECT profile_id, game_id FROM rev
    UNION
    SELECT profile_id, game_id FROM lib WHERE status <> 'want_to_play'
    UNION
    SELECT profile_id, game_id FROM ach WHERE pct > 0 OR platinum
  ), per AS (
    SELECT pe.game_id, pe.profile_id,
           rv.score,
           a.pct,
           coalesce(a.pct >= 1 OR a.platinum, false) AS is_full,
           coalesce(l.status = 'completed' OR a.pct >= 1 OR a.platinum, false) AS is_completed,
           coalesce(l.hours, rv.hours) AS hours
    FROM people pe
    LEFT JOIN rev rv ON rv.profile_id = pe.profile_id AND rv.game_id = pe.game_id
    LEFT JOIN lib l  ON l.profile_id  = pe.profile_id AND l.game_id  = pe.game_id
    LEFT JOIN ach a  ON a.profile_id  = pe.profile_id AND a.game_id  = pe.game_id
  )
  SELECT ids.game_id,
         (SELECT count(*) FROM members)::int,
         count(per.profile_id)::int,
         count(*) FILTER (WHERE per.is_completed)::int,
         count(*) FILTER (WHERE per.is_full)::int,
         count(per.score)::int,
         avg(per.score)::float8,
         count(per.pct)::int,
         avg(per.pct)::float8,
         count(per.hours)::int,
         avg(per.hours)::float8,
         count(per.hours) FILTER (WHERE per.is_completed)::int,
         avg(per.hours) FILTER (WHERE per.is_completed)::float8,
         count(per.hours) FILTER (WHERE per.is_full)::int,
         avg(per.hours) FILTER (WHERE per.is_full)::float8,
         -- A few of each for the card's avatars (the counts above are the totals),
         -- people with a profile picture first
         (array_agg(per.profile_id ORDER BY pr.avatar_url IS NULL, per.profile_id) FILTER (WHERE per.is_full))[1:8],
         (array_agg(per.profile_id ORDER BY pr.avatar_url IS NULL, per.profile_id) FILTER (WHERE per.is_completed))[1:8],
         (array_agg(per.profile_id ORDER BY pr.avatar_url IS NULL, per.profile_id) FILTER (WHERE per.profile_id IS NOT NULL))[1:8],
         -- How many members gave it each score, 1 to 10
         ARRAY[
           count(*) FILTER (WHERE round(per.score) = 1)::int,
           count(*) FILTER (WHERE round(per.score) = 2)::int,
           count(*) FILTER (WHERE round(per.score) = 3)::int,
           count(*) FILTER (WHERE round(per.score) = 4)::int,
           count(*) FILTER (WHERE round(per.score) = 5)::int,
           count(*) FILTER (WHERE round(per.score) = 6)::int,
           count(*) FILTER (WHERE round(per.score) = 7)::int,
           count(*) FILTER (WHERE round(per.score) = 8)::int,
           count(*) FILTER (WHERE round(per.score) = 9)::int,
           count(*) FILTER (WHERE round(per.score) = 10)::int
         ]
  FROM ids
  LEFT JOIN per ON per.game_id = ids.game_id
  LEFT JOIN profiles pr ON pr.id = per.profile_id
  GROUP BY ids.game_id;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_featured_game_stats(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_featured_game_stats(uuid, uuid[]) TO service_role;
