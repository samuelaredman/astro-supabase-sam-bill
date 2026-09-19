-- Merged unlocks view — Steam achievements + PSN trophies as a single stream
-- for the Achievements tab feed. Column names are chosen to match the shape
-- the client already expects (display_name, global_percent, unlock_time,
-- game_title, api_name), so the feed API can swap its source from
-- user_achievements to this view with minimal client-side change.
--
-- source ('steam' | 'psn') drives the per-day grouping in the client so a
-- single day with both platforms renders as two sections.
-- trophy_type is only populated for PSN rows (bronze/silver/gold/platinum);
-- it powers the optional badge treatment.
-- platform_label is 'PS3' | 'PS4' | 'PS5' for PSN rows, NULL for Steam.
-- external_id is text so the view's UNION types line up — steam_appid (int)
-- becomes a decimal string, np_communication_id passes through as-is.

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
WHERE t.earned = true AND t.earned_at IS NOT NULL;

-- Sort/pagination on the view walks each table's (profile_id, unlock_time)
-- range, then Postgres merges + sorts. Partial indexes on the timestamp
-- column keep this fast even for users with 10k+ unlocks. Match existing
-- WHERE clauses so the planner can use them.
CREATE INDEX IF NOT EXISTS user_achievements_unlock_time_idx
  ON user_achievements(profile_id, unlock_time DESC)
  WHERE unlocked = true AND unlock_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_trophies_earned_at_idx
  ON user_trophies(profile_id, earned_at DESC)
  WHERE earned = true AND earned_at IS NOT NULL;

-- The API route reads with the service-role client, so no anon grant needed.
GRANT SELECT ON user_unlocks TO service_role;
