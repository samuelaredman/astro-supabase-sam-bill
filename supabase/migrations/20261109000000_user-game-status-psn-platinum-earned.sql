-- Platinum-earned signal on user_game_status so the Library badge can trust
-- the lightweight psn/sync-library pass alone. Without this, we only knew a
-- platinum was earned once the heavier psn/sync-trophies pass populated per-
-- trophy rows (the library query used to filter user_trophies for
-- trophy_type='platinum' AND earned=true). Users who ran library sync but not
-- trophy sync saw platinumed games render as sub-100% instead of perfect.
--
-- Populated from Sony's getUserTitles earnedTrophies.platinum count, which the
-- sync-library endpoint already receives but previously discarded.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS psn_platinum_earned boolean NOT NULL DEFAULT false;
