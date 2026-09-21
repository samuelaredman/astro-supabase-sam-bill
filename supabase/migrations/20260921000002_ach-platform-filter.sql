-- The Achievements tab gets its own Platform filter that mirrors the
-- Library tab's Steam / PS3 / PS4 / PS5 / Xbox 360 / Xbox One / Xbox
-- Series X|S / Xbox (generic) buckets. Two pieces are needed here:
--
--   1. Extend the user_unlocks view so Xbox rows carry the console name
--      in platform_label (was hard-coded NULL). Pulled from
--      user_game_status.xbox_platform via a LEFT JOIN on (profile_id,
--      xbox_title_id) — the same row the library sync writes.
--      Rows that predate xbox_platform stay NULL and get bucketed under
--      the generic "Xbox" option in the UI until the user re-syncs.
--
--   2. Add user_unlock_platforms(profile_id): the distinct set of
--      (source, platform_label) pairs the profile has unlocks in, so
--      the dropdown lists only options that would actually match
--      something. Cheap DISTINCT over three profile-indexed tables.
--
-- Steam + PSN branches of the view are unchanged. Service_role grant
-- matches the rest of the achievements pipeline — the API uses admin.

CREATE OR REPLACE VIEW user_unlocks AS
SELECT
  a.profile_id,
  'steam'::text          AS source,
  a.display_name,
  a.description,
  a.icon_url,
  a.global_percent::real AS global_percent,
  a.unlock_time,
  a.steam_appid::text    AS external_id,
  a.api_name,
  COALESCE(g.title, a.steam_game_title) AS game_title,
  NULL::text             AS trophy_type,
  NULL::text             AS platform_label
FROM user_achievements a
LEFT JOIN games g ON g.id = a.game_id
WHERE a.unlocked = true AND a.unlock_time IS NOT NULL

UNION ALL

SELECT
  t.profile_id,
  'psn'::text            AS source,
  t.name                 AS display_name,
  t.description,
  t.icon_url,
  t.earned_rate::real    AS global_percent,
  t.earned_at            AS unlock_time,
  t.np_communication_id  AS external_id,
  NULL::text             AS api_name,
  COALESCE(g.title, t.psn_game_title) AS game_title,
  t.trophy_type,
  t.psn_platform         AS platform_label
FROM user_trophies t
LEFT JOIN games g ON g.id = t.game_id
WHERE t.earned = true AND t.earned_at IS NOT NULL

UNION ALL

SELECT
  x.profile_id,
  'xbox'::text           AS source,
  x.name                 AS display_name,
  x.description,
  x.icon_url,
  x.rarity::real         AS global_percent,
  x.unlocked_at          AS unlock_time,
  x.xbox_title_id        AS external_id,
  x.achievement_id       AS api_name,
  COALESCE(g.title, x.xbox_game_title) AS game_title,
  x.gamerscore::text     AS trophy_type,
  ugs.xbox_platform      AS platform_label
FROM user_xbox_achievements x
LEFT JOIN games g ON g.id = x.game_id
LEFT JOIN user_game_status ugs
  ON ugs.profile_id = x.profile_id AND ugs.xbox_title_id = x.xbox_title_id
WHERE x.unlocked = true AND x.unlocked_at IS NOT NULL;

GRANT SELECT ON user_unlocks TO service_role;

CREATE OR REPLACE FUNCTION user_unlock_platforms(p_profile_id uuid)
RETURNS TABLE(source text, platform_label text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT u.source, u.platform_label
  FROM user_unlocks u
  WHERE u.profile_id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION user_unlock_platforms(uuid) TO service_role;
