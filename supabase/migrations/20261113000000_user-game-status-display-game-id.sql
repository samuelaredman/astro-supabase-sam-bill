-- Add display_game_id to user_game_status.
--
-- The platform imports (Steam/PSN/Xbox) record ownership against the canonical
-- game id so one row aggregates playtime/achievements across every edition the
-- user owns that collapses into it. That's correct for aggregation + the review
-- link, but the library grid then showed the canonical title even when the
-- user actually owned an edition (e.g. "Okami" instead of "Okami HD").
--
-- display_game_id is the "primary" edition the import picked (most-recently-
-- played; fallback highest playtime/progress) — the one whose title/cover the
-- library should render. NULL means "no edition picked, use the canonical row
-- for display" (manual adds, pre-migration rows, non-platform imports). ON
-- DELETE SET NULL so pruning an edition row doesn't cascade-delete the user's
-- library entry.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS display_game_id uuid REFERENCES games(id) ON DELETE SET NULL;
