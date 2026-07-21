-- Replace the directional UNIQUE(profile_id, source_game_id, target_game_id) with an
-- unordered constraint so that (profile, X→Y) and (profile, Y→X) are treated as the
-- same pair. This means a recommendation counts for both games and the reverse can't
-- be posted by the same author.

-- Drop the auto-named directional constraint from the CREATE TABLE in 20260705000000
ALTER TABLE recommendations
  DROP CONSTRAINT IF EXISTS recommendations_profile_id_source_game_id_target_game_id_key;

-- Functional unique index: normalise the pair so LEAST() is always first
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_unordered_pair_idx
  ON recommendations (profile_id, LEAST(source_game_id, target_game_id), GREATEST(source_game_id, target_game_id));
