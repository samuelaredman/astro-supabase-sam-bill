-- Backloggd library import
-- ------------------------
-- Companion to the Backloggd review import. Brings a user's Backloggd game
-- library across as `user_game_status` rows, mapping Backloggd's play states:
--   Played / Completed / Mastered -> completed
--   Playing                       -> playing
--   Backlog / Wishlist            -> want_to_play
--   Retired / Shelved / Abandoned -> dropped
--
-- Backloggd fronts its /u/<user>/games/ pages with an Anubis proof-of-work bot
-- challenge, so this can't be scraped server-side like the reviews are. The
-- library is captured in the user's own browser (a console snippet, served from
-- /api/import/backloggd/library-scraper.js) and uploaded as JSON, then matched
-- and applied by /api/import/backloggd/library in one request — so there's no
-- job table here, only a per-user cooldown timestamp (mirrors steam_synced_at).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS backloggd_synced_at TIMESTAMPTZ;
