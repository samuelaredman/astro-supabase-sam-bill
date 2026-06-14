ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS shared_to_feed boolean NOT NULL DEFAULT false;
