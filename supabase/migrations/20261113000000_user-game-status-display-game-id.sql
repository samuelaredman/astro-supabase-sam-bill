-- Per-platform display edition for library rendering.
--
-- The platform imports (Steam/PSN/Xbox) record ownership against the canonical
-- game id so one row aggregates playtime/achievements/review across every
-- edition the user owns. Correct for aggregation, but the library grid showed
-- the canonical title/cover even when the user actually owns an edition
-- (e.g. "Okami" when they own "Okami HD").
--
-- These columns record the primary edition each platform's import picked (the
-- same tiebreaker they already use for appid/last_played). The library query
-- reads the relevant column per platform split row — detailed view shows each
-- platform's own edition, overview takes the first available. Each sync only
-- writes its own column, so re-syncing Steam never clobbers the PSN edition.
--
-- NULL = "no edition recorded, use the canonical row for display" (manual
-- adds, pre-migration rows, non-platform imports). ON DELETE SET NULL so
-- pruning an edition row doesn't cascade-delete the library entry.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS steam_display_game_id uuid REFERENCES games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS psn_display_game_id   uuid REFERENCES games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS xbox_display_game_id  uuid REFERENCES games(id) ON DELETE SET NULL;
