-- Dedicated cursor + snapshot columns for the library sync's new cursor-based
-- pagination (sync-library.ts). Previously sync-library did all its work in a
-- single request, capped at 10 IGDB auto-imports — for a 4,000-title PSN
-- library that meant 400+ user clicks to drain. The new flow snapshots the
-- unmatched work once, then batches through it across multiple calls.
--
-- Separate from psn_sync_cursor / psn_sync_snapshot (which belong to
-- sync-trophies.ts) so the two syncs can run back-to-back without clobbering
-- each other's state.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS psn_library_sync_cursor jsonb,
  ADD COLUMN IF NOT EXISTS psn_library_sync_snapshot jsonb;
