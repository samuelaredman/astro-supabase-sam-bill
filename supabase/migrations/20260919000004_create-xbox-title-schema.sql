-- Per-title Xbox achievement schema cache — parallels steam_app_schema and
-- psn_title_schema. Every user of the same title shares metadata (names,
-- descriptions, icons, rarity), so we fetch once per title and reuse
-- across all users' syncs.
--
-- no_achievements is a durable marker for titles OpenXBL confirms have no
-- achievement data (rare — mostly apps and prototypes). Cached so future
-- syncs skip them entirely, same as steam_app_schema.no_achievements and
-- psn_title_schema.no_trophies.
CREATE TABLE IF NOT EXISTS xbox_title_schema (
  xbox_title_id     text        PRIMARY KEY,
  achievements      jsonb,       -- [{ id, name, description, icon_url, gamerscore, rarity }]
  no_achievements   bool        NOT NULL DEFAULT false,
  fetched_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE xbox_title_schema ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Xbox title schemas are publicly readable"
  ON xbox_title_schema FOR SELECT USING (true);
