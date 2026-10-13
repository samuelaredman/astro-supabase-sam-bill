-- Look up one profile's achievements for one game, on all three platforms.
-- group_versus_profile reads each side's completion for the games they
-- reviewed; without these it scans every achievement a profile has synced
-- (thousands) once per review.

CREATE INDEX IF NOT EXISTS user_achievements_profile_game_id_idx
  ON user_achievements (profile_id, game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_trophies_profile_game_id_idx
  ON user_trophies (profile_id, game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_xbox_achievements_profile_game_id_idx
  ON user_xbox_achievements (profile_id, game_id) WHERE game_id IS NOT NULL;
