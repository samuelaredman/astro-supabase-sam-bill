-- HowLongToBeat library + review import
-- --------------------------------------
-- HLTB has no public API we can use server-side (Cloudflare + the SPA auth
-- cookie), so the whole import runs in the user's own browser via a bookmarklet
-- (served from /api/import/hltb/library-scraper.js). The bookmarklet downloads
-- a JSON file with every tracked game — status, playtime minutes, score and
-- optional review body — and the user uploads it in /settings#hltb, which hits
-- /api/import/hltb/library in chunks.
--
-- Data model additions:
--   - user_game_status.hltb_playtime_minutes — mirrors steam_playtime_minutes /
--     psn_playtime_minutes so a game can carry hours from HLTB when it has no
--     Steam/PSN source. Nullable; set only when the uploaded row has minutes.
--   - profiles.hltb_synced_at — cooldown timestamp, mirrors backloggd_synced_at
--     / steam_synced_at. The import endpoint rate-limits a user to one sync
--     per minute.
--
-- Reviews brought over from HLTB go in the normal `reviews` table. A rating
-- without a body comes in as status='draft' (so the user can finish writing
-- it); a rating with a body comes in as status='published'. HLTB's 1–10 scale
-- maps 1:1 to Chekpoint's 1–10 integer scores.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS hltb_playtime_minutes int;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hltb_synced_at TIMESTAMPTZ;
