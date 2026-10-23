-- Per-list display flags: hours badge and achievement completion badge.
-- Both default true so lists come with every cover badge visible out of the
-- box; owners can turn either off from the list's Edit page. The achievement
-- fetch is skipped per-render when show_achievements is false, so flipping
-- the toggle also skips the RPC calls (no cost on an empty list page).
ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS show_hours        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_achievements BOOLEAN NOT NULL DEFAULT true;
