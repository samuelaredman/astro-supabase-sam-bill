-- Store the Steam appid on game status rows so achievement sync knows
-- which Steam appid to query for each matched game.
ALTER TABLE user_game_status ADD COLUMN IF NOT EXISTS steam_appid int;

CREATE INDEX IF NOT EXISTS user_game_status_steam_appid_idx
  ON user_game_status(profile_id, steam_appid)
  WHERE steam_appid IS NOT NULL;
