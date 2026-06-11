-- Widen the status check constraint to include the two new statuses
-- added in the game library update: 'owned' and 'hundred_percent'.
ALTER TABLE user_game_status
  DROP CONSTRAINT IF EXISTS user_game_status_status_check;

ALTER TABLE user_game_status
  ADD CONSTRAINT user_game_status_status_check
  CHECK (status IN ('playing', 'want_to_play', 'owned', 'completed', 'hundred_percent', 'dropped'));
