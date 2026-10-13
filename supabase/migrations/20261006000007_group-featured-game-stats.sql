-- The members' numbers for each featured game on a group's Games tab
-- (src/utils/groupFeaturedGames.ts): how many of the group played it, finished
-- it, 100%'d or platinumed it, and their average rating, achievement % and hours.
--
-- - Ratings and review hours come from group_reviews(), like the other group
--   stats (published reviews by current members). The group's genre/platform
--   focus isn't applied: the creator picked these games by hand.
-- - Library data (status, synced playtime, achievements) counts only for members
--   whose library is public, and never for a game they've hidden from it.
--   Synced hours also respect library_show_hours.
-- - Achievement % is the best of Steam / PSN / Xbox, as in
--   group_versus_game_details(). "Full" is 100% on any of them or an earned
--   PSN platinum, so a platinum counts even when DLC trophies are missing.
-- - Hours are the synced Steam/PSN playtime, else the hours on the review.
-- - Played means any of: a review, a library status other than want to play,
--   or any unlocked achievement. Completed is the "completed" status or full.

CREATE INDEX IF NOT EXISTS user_achievements_game_profile_idx
  ON user_achievements (game_id, profile_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_trophies_game_profile_idx
  ON user_trophies (game_id, profile_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_xbox_achievements_game_profile_idx
  ON user_xbox_achievements (game_id, profile_id) WHERE game_id IS NOT NULL;

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
  full_profile_ids uuid[]
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
         -- A few of them for the card's avatars; the count above is the total
         (array_agg(per.profile_id ORDER BY per.profile_id) FILTER (WHERE per.is_full))[1:8]
  FROM ids
  LEFT JOIN per ON per.game_id = ids.game_id
  GROUP BY ids.game_id;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_featured_game_stats(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_featured_game_stats(uuid, uuid[]) TO service_role;
