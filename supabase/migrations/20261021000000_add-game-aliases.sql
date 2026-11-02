-- game_aliases: alternative titles that should resolve to the same canonical
-- game row. Populated automatically by the canonical-only import (every time
-- importGameByIgdbId resolves a variant igdb_id to its version_parent, the
-- variant's title + igdb_id get recorded here) and manually via future admin
-- merge tooling. Search integrations (/api/games/search, /search) join on this
-- so a user typing "Sekiro GOTY" still finds the base Sekiro row — without
-- which, dropping the variant from the catalog would silently lose discoverability.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS game_aliases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  igdb_id     int,
  source      text        NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_aliases_game_title_key UNIQUE (game_id, title)
);

-- Fast "have we already recorded this variant igdb_id?" check for the import flow.
CREATE UNIQUE INDEX IF NOT EXISTS game_aliases_igdb_id_key
  ON game_aliases (igdb_id) WHERE igdb_id IS NOT NULL;

-- Trigram index for the search integration's ilike lookup.
CREATE INDEX IF NOT EXISTS game_aliases_title_trgm
  ON game_aliases USING gin (title gin_trgm_ops);

ALTER TABLE game_aliases ENABLE ROW LEVEL SECURITY;

-- Public read: aliases participate in search for logged-out visitors too.
DROP POLICY IF EXISTS "game_aliases_public_read" ON game_aliases;
CREATE POLICY "game_aliases_public_read" ON game_aliases FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policy — writes are admin-client-only (import flow +
-- future admin merge tooling), matching the pattern on other catalog tables.
