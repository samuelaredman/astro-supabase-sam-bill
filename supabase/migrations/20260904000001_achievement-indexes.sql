-- Speed up the achievements feed (default sort = unlock_time DESC, unlocked=true)
CREATE INDEX IF NOT EXISTS user_achievements_profile_unlocktime_idx
  ON user_achievements(profile_id, unlock_time DESC NULLS LAST)
  WHERE unlocked = true AND unlock_time IS NOT NULL;

-- Speed up get_achievement_stats() GROUP BY steam_appid
CREATE INDEX IF NOT EXISTS user_achievements_profile_game_idx
  ON user_achievements(profile_id, steam_appid);
