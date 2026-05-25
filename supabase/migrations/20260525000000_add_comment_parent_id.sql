ALTER TABLE review_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES review_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS review_comments_parent_id_idx ON review_comments(parent_id);
