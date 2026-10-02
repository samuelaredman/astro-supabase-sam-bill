-- PSN trophies — parallels user_achievements for Steam.
--
-- Key differences vs Steam:
--   1. PSN identifies games by npCommunicationId (e.g. NPWR12345_00), not
--      an int appid.
--   2. Trophies belong to a trophy_group_id — "default" for base game, "001",
--      "002" etc. for DLC / post-launch expansions. Uniqueness includes group.
--   3. trophy_type distinguishes bronze/silver/gold/platinum — surface this in
--      the UI (platinums are the marquee status symbol for PSN users).
--   4. np_service_name is "trophy" (PS3/PS4/Vita) or "trophy2" (PS5-native).
--      Required as a query param on GetTitleTrophies and related endpoints.
--   5. earned_rate is Sony's own rarity % (comes as a string in the API but
--      stored as float here for sorting).
CREATE TABLE IF NOT EXISTS user_trophies (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id             uuid        REFERENCES games(id) ON DELETE SET NULL,
  np_communication_id text        NOT NULL,
  np_service_name     text        NOT NULL,
  trophy_group_id     text        NOT NULL,
  trophy_id           int         NOT NULL,
  trophy_type         text        NOT NULL,
  psn_platform        text        NOT NULL,
  psn_game_title      text,
  name                text,
  description         text,
  icon_url            text,
  hidden              bool        NOT NULL DEFAULT false,
  earned              bool        NOT NULL DEFAULT false,
  earned_at           timestamptz,
  earned_rate         float,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, np_communication_id, trophy_group_id, trophy_id)
);

CREATE INDEX IF NOT EXISTS user_trophies_profile_idx
  ON user_trophies(profile_id);
CREATE INDEX IF NOT EXISTS user_trophies_rarest_idx
  ON user_trophies(profile_id, earned_rate ASC)
  WHERE earned = true;
CREATE INDEX IF NOT EXISTS user_trophies_platinum_idx
  ON user_trophies(profile_id, np_communication_id)
  WHERE trophy_type = 'platinum' AND earned = true;

ALTER TABLE user_trophies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trophies are publicly readable"
  ON user_trophies FOR SELECT USING (true);

CREATE POLICY "Users manage their own trophies"
  ON user_trophies FOR ALL
  USING (profile_id = get_my_profile_id());
