CREATE INDEX IF NOT EXISTS idx_reviews_published_feed
  ON reviews (published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_reviews_profile_published
  ON reviews (profile_id, published_at DESC)
  WHERE status = 'published';
