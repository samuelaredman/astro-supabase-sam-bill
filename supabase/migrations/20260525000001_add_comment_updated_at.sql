ALTER TABLE review_comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
