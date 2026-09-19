-- Xbox achievements — parallels user_achievements (Steam) and user_trophies (PSN).
--
-- Key differences vs the other two:
--   1. Xbox identifies games by titleId (text — old 360 IDs use hex forms).
--   2. Achievements have a `gamerscore` (10-200 points typically) — Xbox's
--      brag equivalent to a PSN platinum. Sum per profile is the classic
--      "Gamerscore" number.
--   3. rarity is Xbox's own global % of players who unlocked it — same
--      semantic as Steam's global_percent and PSN's earned_rate. Stored as
--      float (0-100) to match those.
--   4. No "trophy_group" concept — Xbox achievements are flat per title.
CREATE TABLE IF NOT EXISTS user_xbox_achievements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id           uuid        REFERENCES games(id) ON DELETE SET NULL,
  xbox_title_id     text        NOT NULL,
  achievement_id    text        NOT NULL,
  xbox_game_title   text,
  name              text,
  description       text,
  icon_url          text,
  gamerscore        int,
  rarity            float,
  unlocked          bool        NOT NULL DEFAULT false,
  unlocked_at       timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, xbox_title_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS user_xbox_achievements_profile_idx
  ON user_xbox_achievements(profile_id);
CREATE INDEX IF NOT EXISTS user_xbox_achievements_rarest_idx
  ON user_xbox_achievements(profile_id, rarity ASC)
  WHERE unlocked = true;
CREATE INDEX IF NOT EXISTS user_xbox_achievements_unlocked_at_idx
  ON user_xbox_achievements(profile_id, unlocked_at DESC)
  WHERE unlocked = true AND unlocked_at IS NOT NULL;

ALTER TABLE user_xbox_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Xbox achievements are publicly readable"
  ON user_xbox_achievements FOR SELECT USING (true);

CREATE POLICY "Users manage their own Xbox achievements"
  ON user_xbox_achievements FOR ALL
  USING (profile_id = get_my_profile_id());
