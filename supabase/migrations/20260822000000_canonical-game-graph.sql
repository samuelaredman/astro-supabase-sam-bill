-- ─────────────────────────────────────────────────────────────────────────────
--  Canonical game graph — Phase 1 (additive schema only)
--
--  Introduces the backbone for collapsing duplicate game "editions/versions" into
--  a single canonical, reviewable node, plus the typed relationship graph, Steam
--  appid mapping, review revisions, and multi-platform reviews.
--
--  EVERYTHING HERE IS ADDITIVE. It deliberately does NOT touch the baseline
--  objects that predate migration tracking:
--    - the reviews_one_published_per_game partial unique index  (swapped in Phase 4)
--    - the search_games() RPC                                    (Phase 5)
--    - the match_steam_games() RPC                               (Phase 7)
--  Those must be captured from the live DB first (see Phase 0). No read-path or
--  write-path behavior changes until later phases wire these columns/tables in.
--
--  After applying: regenerate supabase/types.ts before writing any code that
--  queries the new tables (per CLAUDE.md — never `as any`).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── games: canonical pointer + raw IGDB relationship metadata ─────────────────
-- canonical_game_id IS NULL  →  this row IS the canonical, reviewable node.
-- canonical_game_id set      →  this row is a collapsed edition; its page reroutes
--                               to the canonical row and its reviews belong there.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS canonical_game_id   uuid REFERENCES games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS igdb_parent_game    integer,
  ADD COLUMN IF NOT EXISTS igdb_version_parent integer,
  ADD COLUMN IF NOT EXISTS version_title       text,
  ADD COLUMN IF NOT EXISTS canonical_locked    boolean NOT NULL DEFAULT false;

-- A row can never be its own canonical.
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_canonical_not_self;
ALTER TABLE games ADD CONSTRAINT games_canonical_not_self
  CHECK (canonical_game_id IS NULL OR canonical_game_id <> id);

-- Browse/search filter (Phase 5) selects canonical nodes; editions resolve up.
CREATE INDEX IF NOT EXISTS idx_games_canonical_null
  ON games (id) WHERE canonical_game_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_games_canonical_game_id
  ON games (canonical_game_id) WHERE canonical_game_id IS NOT NULL;

-- Enforce a single level of collapse: an edition points directly at a canonical
-- node, never at another edition, and a row that other editions point to cannot
-- itself become an edition. Keeps the graph flat so reroute/aggregation stay O(1).
CREATE OR REPLACE FUNCTION enforce_canonical_single_level()
RETURNS trigger AS $$
BEGIN
  IF NEW.canonical_game_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = NEW.canonical_game_id AND g.canonical_game_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'canonical_game_id % is itself an edition — chains are not allowed', NEW.canonical_game_id;
    END IF;
    IF EXISTS (SELECT 1 FROM games g WHERE g.canonical_game_id = NEW.id) THEN
      RAISE EXCEPTION 'game % is a canonical target for other editions and cannot become an edition', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_canonical_single_level ON games;
CREATE TRIGGER trg_enforce_canonical_single_level
  BEFORE INSERT OR UPDATE OF canonical_game_id ON games
  FOR EACH ROW EXECUTE FUNCTION enforce_canonical_single_level();

-- ── game_relationships: typed game↔game graph (connected-but-separate content) ─
CREATE TABLE IF NOT EXISTS game_relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_game_id  uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  to_game_id    uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN (
    'dlc', 'expansion', 'standalone_expansion', 'remake',
    'expanded_game', 'sequel', 'series_sibling', 'similar'
  )),
  source        text NOT NULL DEFAULT 'igdb' CHECK (source IN ('igdb', 'manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_relationships_distinct CHECK (from_game_id <> to_game_id),
  UNIQUE (from_game_id, to_game_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_game_rel_from ON game_relationships (from_game_id);
CREATE INDEX IF NOT EXISTS idx_game_rel_to   ON game_relationships (to_game_id);

ALTER TABLE game_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_relationships_public_read" ON game_relationships;
CREATE POLICY "game_relationships_public_read" ON game_relationships FOR SELECT USING (true);

-- ── game_steam_apps: Steam appid → game (many appids per game) ─────────────────
-- Populated from IGDB external_games. Sync resolves appid → game_id → canonical.
CREATE TABLE IF NOT EXISTS game_steam_apps (
  steam_appid integer PRIMARY KEY,
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_steam_apps_game ON game_steam_apps (game_id);

ALTER TABLE game_steam_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_steam_apps_public_read" ON game_steam_apps;
CREATE POLICY "game_steam_apps_public_read" ON game_steam_apps FOR SELECT USING (true);

-- ── game_revisions: notable change events on a canonical game ──────────────────
-- Every canonical game gets a baseline kind='release' revision (created by the
-- Phase 3 backfill). A collapsed edition that adds content (e.g. Skyrim AE) also
-- creates a revision so prior reviewers get a re-review prompt.
CREATE TABLE IF NOT EXISTS game_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN (
    'release', 'version', 'major_patch', 'dlc', 'remaster_merge', 'edition'
  )),
  igdb_ref    integer,
  label       text,
  released_at date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_game_revisions_game ON game_revisions (game_id);

ALTER TABLE game_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_revisions_public_read" ON game_revisions;
CREATE POLICY "game_revisions_public_read" ON game_revisions FOR SELECT USING (true);

-- ── reviews.revision_id: which revision a score applies to ─────────────────────
-- Additive only. The one-published-per-revision unique index REPLACES
-- reviews_one_published_per_game in Phase 4, after the baseline is captured and
-- reviews are reconciled. Do NOT drop the old index here.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES game_revisions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_revision ON reviews (revision_id);

-- ── review_platforms: multi-value "played on" (still required, now a set) ──────
-- Platform is categorical metadata, never part of review identity. Replaces the
-- single reviews.platform_played_on FK. The old column is kept through the
-- transition and dropped once read-paths are cut over (Phase 5).
CREATE TABLE IF NOT EXISTS review_platforms (
  review_id   uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, platform_id)
);
CREATE INDEX IF NOT EXISTS idx_review_platforms_platform ON review_platforms (platform_id);

ALTER TABLE review_platforms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_platforms_public_read" ON review_platforms;
CREATE POLICY "review_platforms_public_read" ON review_platforms FOR SELECT USING (true);

-- Seed the junction from existing single-platform reviews (idempotent).
INSERT INTO review_platforms (review_id, platform_id)
SELECT id, platform_played_on FROM reviews
WHERE platform_played_on IS NOT NULL
ON CONFLICT (review_id, platform_id) DO NOTHING;

-- ── current_reviews: the authoritative "latest score per user per game" ────────
-- All averages/rankings/counts/display read from this view (Phase 5). The full
-- reviews table remains the score-history timeline (taste-match, profile feel).
CREATE OR REPLACE VIEW current_reviews AS
SELECT DISTINCT ON (r.profile_id, r.game_id) r.*
FROM reviews r
WHERE r.status = 'published'
ORDER BY r.profile_id, r.game_id,
         r.published_at DESC NULLS LAST,
         r.created_at   DESC NULLS LAST,
         r.id           DESC;

-- Respect the querying role's RLS (anon already only sees published reviews).
ALTER VIEW current_reviews SET (security_invoker = true);
