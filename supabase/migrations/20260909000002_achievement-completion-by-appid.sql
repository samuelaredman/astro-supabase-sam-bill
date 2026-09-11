-- Per-game achievement completion for a profile: one row per Steam app with a
-- synced achievement set, `pct` in 0..1. Powers the Library "Completion %" sort.
-- Bounded by the profile's synced-game count (hundreds at most) and index-
-- assisted by user_achievements_profile_game_idx (profile_id, steam_appid).

CREATE OR REPLACE FUNCTION achievement_completion_by_appid(p_profile_id uuid)
RETURNS TABLE(steam_appid int, pct real) LANGUAGE sql STABLE AS $$
  SELECT steam_appid,
         (count(*) FILTER (WHERE unlocked))::real / NULLIF(count(*), 0)::real AS pct
  FROM user_achievements
  WHERE profile_id = p_profile_id
  GROUP BY steam_appid;
$$;
