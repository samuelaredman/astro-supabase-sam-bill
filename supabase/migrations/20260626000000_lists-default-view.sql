-- Add default_view preference to lists
ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS default_view TEXT NOT NULL DEFAULT 'grid'
              CHECK (default_view IN ('grid', 'list'));
