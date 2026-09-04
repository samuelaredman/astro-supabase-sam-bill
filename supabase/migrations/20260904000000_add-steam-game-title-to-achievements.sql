-- Store the Steam game title directly on achievement rows so games not yet
-- imported into the games table still display a human-readable name.
ALTER TABLE user_achievements
  ADD COLUMN IF NOT EXISTS steam_game_title text;
