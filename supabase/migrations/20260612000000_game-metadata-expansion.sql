-- ─────────────────────────────────────────────────────────────────────────────
--  Game metadata expansion
--  Adds igdb_category, igdb_status, storyline to games.
--  New reference + junction tables for themes, game modes, franchises,
--  and collections — all publicly readable, same RLS pattern as genres/platforms.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS igdb_category smallint,
  ADD COLUMN IF NOT EXISTS igdb_status   smallint,
  ADD COLUMN IF NOT EXISTS storyline     text;

-- ── Themes ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS themes (
  id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT    NOT NULL UNIQUE,
  slug    TEXT    UNIQUE,
  igdb_id INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS game_themes (
  game_id  UUID NOT NULL REFERENCES games(id)  ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, theme_id)
);

ALTER TABLE themes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "themes_public_read"      ON themes      FOR SELECT USING (true);
CREATE POLICY "game_themes_public_read" ON game_themes FOR SELECT USING (true);

-- ── Game modes ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_modes (
  id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT    NOT NULL UNIQUE,
  slug    TEXT    UNIQUE,
  igdb_id INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS game_game_modes (
  game_id      UUID NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  game_mode_id UUID NOT NULL REFERENCES game_modes(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, game_mode_id)
);

ALTER TABLE game_modes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_game_modes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_modes_public_read"      ON game_modes      FOR SELECT USING (true);
CREATE POLICY "game_game_modes_public_read" ON game_game_modes FOR SELECT USING (true);

-- ── Franchises ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS franchises (
  id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT    NOT NULL UNIQUE,
  slug    TEXT    UNIQUE,
  igdb_id INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS game_franchises (
  game_id      UUID NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  franchise_id UUID NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, franchise_id)
);

ALTER TABLE franchises      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_franchises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "franchises_public_read"      ON franchises      FOR SELECT USING (true);
CREATE POLICY "game_franchises_public_read" ON game_franchises FOR SELECT USING (true);

-- ── Collections ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections (
  id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name    TEXT    NOT NULL UNIQUE,
  slug    TEXT    UNIQUE,
  igdb_id INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS game_collections (
  game_id       UUID NOT NULL REFERENCES games(id)       ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, collection_id)
);

ALTER TABLE collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections_public_read"      ON collections      FOR SELECT USING (true);
CREATE POLICY "game_collections_public_read" ON game_collections FOR SELECT USING (true);
