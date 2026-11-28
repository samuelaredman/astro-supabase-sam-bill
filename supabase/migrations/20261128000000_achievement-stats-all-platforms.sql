-- Extend get_achievement_stats to count Perfect Games + Avg Completion
-- across Steam, PSN, and Xbox — previously it only counted Steam.
--
-- Prior symptom: PSN-only profile with ~50 platinums and ~8k earned trophies
-- shows "0 Perfect Games · 0.0% Avg Completion" on the Achievements tab,
-- because get_achievement_stats() only aggregated user_achievements (Steam).
-- The empty-state bug was already fixed in the client code via the
-- user_unlocks count, but the two summary numbers still read 0 for anyone
-- without Steam achievements.
--
-- Semantics:
--   unlocked_count — total unlocks across all three platforms (same as
--                    SELECT COUNT(*) FROM user_unlocks WHERE profile_id = ...).
--   perfect_games  — games where the user has 100% completion. Per-platform:
--     • Steam: all rows in user_achievements for that steam_appid have
--       unlocked=true (and at least one exists).
--     • PSN: psn_platinum_earned=true on user_game_status. This matches
--       PSN's own "platinum" definition (all non-DLC trophies earned),
--       which is what every PSN user already thinks of as "100%". Trying
--       to derive it from user_trophies would incorrectly count DLC
--       trophies against base-game completion.
--     • Xbox: all rows in user_xbox_achievements for that xbox_title_id
--       have unlocked=true.
--   avg_completion — average completion percentage across games the user
--                    has made at least some progress on, unioned across
--                    all three sources. Games with 0 unlocks are excluded
--                    from the average so a dormant synced game doesn't drag
--                    it down.
--
-- Drop + recreate (not CREATE OR REPLACE) in case the historical function
-- had a different return signature we'd fail to change otherwise.

DROP FUNCTION IF EXISTS get_achievement_stats(uuid);

CREATE FUNCTION get_achievement_stats(p_profile_id uuid)
RETURNS TABLE(
  unlocked_count bigint,
  perfect_games  bigint,
  avg_completion numeric
) AS $$
  WITH steam_games AS (
    SELECT
      steam_appid,
      COUNT(*) FILTER (WHERE unlocked = true) AS unlocked,
      COUNT(*)                                 AS total
    FROM user_achievements
    WHERE profile_id = p_profile_id
    GROUP BY steam_appid
    HAVING COUNT(*) > 0
  ),
  psn_games AS (
    SELECT
      np_communication_id,
      COUNT(*) FILTER (WHERE earned = true) AS unlocked,
      COUNT(*)                               AS total
    FROM user_trophies
    WHERE profile_id = p_profile_id
    GROUP BY np_communication_id
    HAVING COUNT(*) > 0
  ),
  xbox_games AS (
    SELECT
      xbox_title_id,
      COUNT(*) FILTER (WHERE unlocked = true) AS unlocked,
      COUNT(*)                                 AS total
    FROM user_xbox_achievements
    WHERE profile_id = p_profile_id
    GROUP BY xbox_title_id
    HAVING COUNT(*) > 0
  ),
  -- Union only for avg_completion; perfect_games uses platform-specific
  -- signals (PSN's platinum vs. Steam/Xbox fully-unlocked).
  all_games AS (
    SELECT unlocked, total FROM steam_games
    UNION ALL
    SELECT unlocked, total FROM psn_games
    UNION ALL
    SELECT unlocked, total FROM xbox_games
  )
  SELECT
    (SELECT COUNT(*) FROM user_unlocks WHERE profile_id = p_profile_id)::bigint
      AS unlocked_count,
    (
      (SELECT COUNT(*) FROM steam_games WHERE unlocked > 0 AND unlocked = total)
      + (SELECT COUNT(*) FROM xbox_games  WHERE unlocked > 0 AND unlocked = total)
      + (SELECT COUNT(*) FROM user_game_status
         WHERE profile_id = p_profile_id AND psn_platinum_earned = true)
    )::bigint AS perfect_games,
    COALESCE(
      (SELECT AVG(unlocked::numeric * 100 / total)
       FROM all_games
       WHERE unlocked > 0),
      0
    )::numeric AS avg_completion;
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION get_achievement_stats(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
