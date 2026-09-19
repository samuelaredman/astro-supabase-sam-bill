-- Extend the user_unlocks view with a third UNION branch for Xbox
-- achievements. Same shape as before — Steam + PSN branches unchanged.
--
-- source enum expands to ('steam' | 'psn' | 'xbox'). The Achievements tab's
-- client groups by (day, source), so a single day with unlocks on all three
-- platforms renders as three consecutive sections.

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
  -- trophy_type slot repurposed for the gamerscore reward — a numeric points
  -- value on Xbox rather than a bronze/silver/gold/platinum tier. Cast to
  -- text so the UNION types match.
  x.gamerscore::text     AS trophy_type,
  NULL::text             AS platform_label
FROM user_xbox_achievements x
LEFT JOIN games g ON g.id = x.game_id
WHERE x.unlocked = true AND x.unlocked_at IS NOT NULL;

-- Same rationale as the PSN pass — the API route reads with the service-
-- role client, so anon grant isn't necessary.
GRANT SELECT ON user_unlocks TO service_role;

-- Xbox completion RPC — parallels achievement_completion_by_appid (Steam)
-- and trophy_completion_by_npcommid (PSN). Powers the library's Completion
-- % sort's Xbox branch.
CREATE OR REPLACE FUNCTION xbox_achievement_completion_by_titleid(p_profile_id uuid)
RETURNS TABLE(xbox_title_id text, pct real) LANGUAGE sql STABLE AS $$
  SELECT xbox_title_id,
         (count(*) FILTER (WHERE unlocked))::real / NULLIF(count(*), 0)::real AS pct
  FROM user_xbox_achievements
  WHERE profile_id = p_profile_id
  GROUP BY xbox_title_id;
$$;
