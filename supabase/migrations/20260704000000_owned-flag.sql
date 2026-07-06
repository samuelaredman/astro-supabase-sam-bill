-- Decouple "owned" from the status enum so it isn't mutually exclusive with
-- completed/hundred_percent/dropped/playing. Mirrors the is_hidden pattern.
ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS is_owned boolean NOT NULL DEFAULT false;

