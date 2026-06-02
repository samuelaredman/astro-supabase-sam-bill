-- ─────────────────────────────────────────────────────────────────────────────
--  User game status — replaces personal watchlist with a full status system
--  Statuses: playing | want_to_play | completed | dropped
--  Privacy (want_to_play + dropped only): public | friends | private
--  "friends" = mutual follows (enforced in application code, not RLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Core table
CREATE TABLE IF NOT EXISTS user_game_status (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id     UUID        NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('playing', 'want_to_play', 'completed', 'dropped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_ugs_profile        ON user_game_status(profile_id);
CREATE INDEX IF NOT EXISTS idx_ugs_game           ON user_game_status(game_id);
CREATE INDEX IF NOT EXISTS idx_ugs_game_status    ON user_game_status(game_id, status);

-- 2. RLS — public read; own rows for writes
--    Privacy filtering (friends/private) is enforced in application code
ALTER TABLE user_game_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ugs_select" ON user_game_status FOR SELECT USING (true);

CREATE POLICY "ugs_insert" ON user_game_status FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "ugs_update" ON user_game_status FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "ugs_delete" ON user_game_status FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 3. Privacy settings on profiles
--    playing + completed are always public (no column needed)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS want_to_play_privacy TEXT NOT NULL DEFAULT 'public'
    CHECK (want_to_play_privacy IN ('public', 'friends', 'private'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dropped_privacy TEXT NOT NULL DEFAULT 'public'
    CHECK (dropped_privacy IN ('public', 'friends', 'private'));
