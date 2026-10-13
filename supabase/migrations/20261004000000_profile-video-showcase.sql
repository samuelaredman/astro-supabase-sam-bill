-- Profile video showcase: show the newest upload from the profile's linked
-- YouTube channel ('latest'), or one chosen video ('featured'). NULL = off.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS showcase_video_mode text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS showcase_video_id text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_showcase_video_mode_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_showcase_video_mode_check
  CHECK (showcase_video_mode IS NULL OR showcase_video_mode IN ('latest', 'featured'));

-- Same 11-char id rule as reviews.youtube_video_id; embed/thumbnail URLs are rebuilt from it.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_showcase_video_id_format;
ALTER TABLE profiles ADD CONSTRAINT profiles_showcase_video_id_format
  CHECK (showcase_video_id IS NULL OR showcase_video_id ~ '^[A-Za-z0-9_-]{11}$');
