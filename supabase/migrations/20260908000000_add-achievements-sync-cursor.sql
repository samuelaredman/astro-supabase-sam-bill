-- Resumable achievement sync. The Steam sync runs in short server-side batches
-- (Netlify's 10s function limit); remembering the last processed appid lets a
-- retry — or a plain page reload — continue instead of restarting from 0.
-- 0 means "no sync in progress / start from the beginning".
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS achievements_sync_cursor int NOT NULL DEFAULT 0;
