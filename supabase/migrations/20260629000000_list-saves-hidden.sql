-- Allow users to hide individual saved lists from their public profile
ALTER TABLE list_saves
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
