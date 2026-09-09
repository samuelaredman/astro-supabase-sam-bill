-- The Library Detailed view showed user_game_status.updated_at as the row's
-- date, which for a Steam-imported game is just "when the last sync touched
-- this row" — so every synced game showed roughly the same (wrong-looking)
-- date and never the actual last-played time.
--
-- Store Steam's rtime_last_played (GetOwnedGames) so the UI can show a real
-- "last played" date for synced games.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS steam_last_played_at timestamptz;
