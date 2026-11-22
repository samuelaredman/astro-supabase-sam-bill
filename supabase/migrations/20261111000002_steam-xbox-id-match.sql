-- Same class of fix as PSN (20261111000001): drop fuzzy title matching in
-- favor of stable platform IDs. Different infrastructure lift for each:
--
--   Steam — game_steam_apps already bridges steam_appid → game_id (populated
--           by importGameByIgdbId's persistSteamAppsFromIgdb), so the matcher
--           just needs to be rewritten to use it. No new table.
--
--   Xbox  — no existing xbox titleId → game bridge. Mirror the PSN shape:
--           games.xbox_title_id column + partial unique index, with the
--           sync-library.ts auto-import pass seeding it.
--
-- Both rewrites drop the old title-based match function entirely. Title
-- fuzzy-matching is non-deterministic across duplicate rows (demonstrated by
-- the Ratchet & Clank 2002-vs-2016 case on PSN) and we'd rather queue a
-- first-sight game for admin review than guess wrong.

-- ─── Steam ────────────────────────────────────────────────────────────────

-- game_steam_apps is many-to-one (multiple appids can point to the same
-- canonical game — editions, regional releases). The matcher returns one row
-- per appid; downstream resolves each to its canonical in the import route.
DROP FUNCTION IF EXISTS match_steam_games(text[]);

CREATE OR REPLACE FUNCTION match_steam_games(steam_appids integer[])
RETURNS TABLE(id uuid, steam_appid integer) AS $$
  SELECT gsa.game_id AS id, gsa.steam_appid
  FROM game_steam_apps gsa
  WHERE gsa.steam_appid = ANY(steam_appids);
$$ LANGUAGE sql STABLE;

-- ─── Xbox ─────────────────────────────────────────────────────────────────

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS xbox_title_id text;

CREATE UNIQUE INDEX IF NOT EXISTS games_xbox_title_id_key
  ON games(xbox_title_id)
  WHERE xbox_title_id IS NOT NULL;

DROP FUNCTION IF EXISTS match_xbox_games(text[]);

CREATE OR REPLACE FUNCTION match_xbox_games(xbox_title_ids text[])
RETURNS TABLE(id uuid, xbox_title_id text) AS $$
  SELECT g.id, g.xbox_title_id
  FROM games g
  WHERE g.xbox_title_id = ANY(xbox_title_ids);
$$ LANGUAGE sql STABLE;

-- Admin review for Xbox titles the matcher + IGDB pass can't resolve. Same
-- model as steam_unmatched_titles (20260703000004) and psn_unmatched_titles
-- (20261111000000): admin-only, RLS on, no policies.
CREATE TABLE IF NOT EXISTS xbox_unmatched_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  xbox_title_id text UNIQUE NOT NULL,
  title text NOT NULL,
  platform text,
  occurrences int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed boolean NOT NULL DEFAULT false
);

ALTER TABLE xbox_unmatched_titles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION log_unmatched_xbox_titles(
  title_ids text[],
  titles text[],
  platforms text[]
)
RETURNS void AS $$
  INSERT INTO xbox_unmatched_titles (xbox_title_id, title, platform)
  SELECT u.c, u.t, u.p
  FROM unnest(title_ids, titles, platforms) AS u(c, t, p)
  WHERE u.c IS NOT NULL AND trim(u.t) <> ''
  ON CONFLICT (xbox_title_id) DO UPDATE SET
    occurrences = xbox_unmatched_titles.occurrences + 1,
    last_seen_at = now(),
    title = EXCLUDED.title,
    platform = EXCLUDED.platform;
$$ LANGUAGE sql;
