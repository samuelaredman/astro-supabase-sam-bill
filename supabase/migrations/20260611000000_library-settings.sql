-- Add is_hidden flag to user_game_status (replaces status='hidden')
ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Convert existing hidden-status rows before tightening the constraint
UPDATE user_game_status
  SET status = 'owned', is_hidden = true
  WHERE status = 'hidden';

-- Remove 'hidden' from valid status values; it is now tracked via is_hidden
ALTER TABLE user_game_status DROP CONSTRAINT IF EXISTS user_game_status_status_check;

ALTER TABLE user_game_status
  ADD CONSTRAINT user_game_status_status_check
  CHECK (status IN ('playing', 'want_to_play', 'owned', 'completed', 'hundred_percent', 'dropped'));

-- Library visibility settings stored on the profile
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS library_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS library_show_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS library_hidden_tabs text[] NOT NULL DEFAULT '{}';
