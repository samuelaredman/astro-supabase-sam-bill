-- Optional YouTube video attached to a review. Only the 11-character video id is
-- stored (never the pasted URL), so nothing user-supplied reaches an embed src.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS youtube_video_id text;

ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS reviews_youtube_video_id_format;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_youtube_video_id_format
  CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
