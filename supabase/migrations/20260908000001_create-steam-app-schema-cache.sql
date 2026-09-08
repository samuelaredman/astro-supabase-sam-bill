-- Per-app cache of Steam's GetSchemaForGame + GetGlobalAchievementPercentages
-- payloads. GetSchemaForGame is rate-limited per API key and shared across every
-- user of the app, so a single large library could exhaust it and stall the
-- achievement sync. Caching the schema (achievement metadata + icons) and the
-- global unlock percentages by appid means each game is fetched from Steam at
-- most once per TTL, no matter how many users sync it.
CREATE TABLE IF NOT EXISTS steam_app_schema (
  steam_appid     int         PRIMARY KEY,
  achievements    jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- availableGameStats.achievements
  global_percents jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { api_name: percent }
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE steam_app_schema ENABLE ROW LEVEL SECURITY;

-- Public game metadata — readable by anyone, writable only by the service role
-- (the sync route uses the admin client, which bypasses RLS).
CREATE POLICY "Steam app schema is publicly readable"
  ON steam_app_schema FOR SELECT USING (true);
