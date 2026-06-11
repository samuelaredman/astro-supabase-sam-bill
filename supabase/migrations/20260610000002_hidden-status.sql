-- Add 'hidden' status: visible only to the profile owner, never shown to others.
ALTER TABLE user_game_status DROP CONSTRAINT IF EXISTS user_game_status_status_check;

ALTER TABLE user_game_status ADD CONSTRAINT user_game_status_status_check
  CHECK (status IN ('playing', 'want_to_play', 'owned', 'completed', 'hundred_percent', 'dropped', 'hidden'));
