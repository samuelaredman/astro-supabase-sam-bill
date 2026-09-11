CREATE TABLE IF NOT EXISTS user_achievements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id           uuid        REFERENCES games(id) ON DELETE SET NULL,
  steam_appid       int         NOT NULL,
  api_name          text        NOT NULL,
  display_name      text,
  description       text,
  icon_url          text,
  icon_gray_url     text,
  hidden            bool        NOT NULL DEFAULT false,
  unlocked          bool        NOT NULL DEFAULT false,
  unlock_time       timestamptz,
  global_percent    float,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, steam_appid, api_name)
);

CREATE INDEX IF NOT EXISTS user_achievements_profile_idx
  ON user_achievements(profile_id);
CREATE INDEX IF NOT EXISTS user_achievements_rarest_idx
  ON user_achievements(profile_id, global_percent ASC)
  WHERE unlocked = true;

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Achievements are publicly readable"
  ON user_achievements FOR SELECT USING (true);

CREATE POLICY "Users manage their own achievements"
  ON user_achievements FOR ALL
  USING (profile_id = get_my_profile_id());
