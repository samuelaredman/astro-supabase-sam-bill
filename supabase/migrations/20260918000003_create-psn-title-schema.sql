-- Per-title trophy schema cache — parallels steam_app_schema.
--
-- Trophy schemas (list of all trophies for a title, with names/descriptions/
-- icons/rarities) are shared across every user of that title. Cache them once
-- so the per-user sync only needs the small GetUserTrophiesEarnedForTitle call.
--
-- Keyed on np_communication_id (not appid — this is the PSN world). fetched_at
-- lets the sync route decide when to refresh (30-day TTL like Steam's schema).
--
-- no_trophies is a durable marker for titles Sony has confirmed have no trophy
-- API (rare — mostly free apps / launcher stubs). Cached so future syncs skip
-- them entirely, same as steam_app_schema.no_achievements.
CREATE TABLE IF NOT EXISTS psn_title_schema (
  np_communication_id text        PRIMARY KEY,
  np_service_name     text,
  trophy_groups       jsonb,        -- list of { trophyGroupId, name, iconUrl, definedTrophies }
  trophies            jsonb,        -- flattened [{ trophyGroupId, trophyId, trophyType, trophyName, trophyDetail, trophyIconUrl, trophyHidden, trophyEarnedRate }]
  trophy_set_version  text,
  no_trophies         bool        NOT NULL DEFAULT false,
  fetched_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE psn_title_schema ENABLE ROW LEVEL SECURITY;

-- Read is unrestricted; writes only via service_role (sync routes).
CREATE POLICY "PSN title schemas are publicly readable"
  ON psn_title_schema FOR SELECT USING (true);
