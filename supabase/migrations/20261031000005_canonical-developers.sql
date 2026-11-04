-- ─────────────────────────────────────────────────────────────────────────────
--  Canonical studios — the studio version of games.canonical_game_id
--  (migration 20260822000000).
--
--  IGDB has duplicate company entries ("LucasArts" / "Lucas Arts", "Ubisoft
--  Entertainment" / "Ubi Soft Entertainment"), each with its own igdb_id, and we
--  import both. A duplicate is never deleted, because a later import keyed on its
--  igdb_id would just recreate it. It points at the main row instead:
--
--    canonical_developer_id IS NULL  →  this row IS the studio.
--    canonical_developer_id set      →  a duplicate. Its page 301s to the main
--                                       studio, its name is shown and searched as
--                                       an "also known as", and it owns no games.
--
--  Schema only: no studio is merged here. Merges are data, done per studio with
--  merge_developer() (see scripts/build-studio-merges.ts).
--  After applying, regenerate supabase/types.ts.
--
--  ROLLBACK (removes everything this file adds; run any merge file's own
--  rollback first, or merged studios keep their moved links):
--    DROP TRIGGER IF EXISTS trg_game_companies_use_canonical_developer ON game_companies;
--    DROP FUNCTION IF EXISTS game_companies_use_canonical_developer();
--    DROP FUNCTION IF EXISTS merge_developer(uuid, uuid);
--    DROP TRIGGER IF EXISTS trg_enforce_developer_canonical_single_level ON developers;
--    DROP FUNCTION IF EXISTS enforce_developer_canonical_single_level();
--    ALTER TABLE developers DROP COLUMN IF EXISTS canonical_developer_id;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE developers
  ADD COLUMN IF NOT EXISTS canonical_developer_id uuid REFERENCES developers(id) ON DELETE SET NULL;

-- A studio can never be its own duplicate.
ALTER TABLE developers DROP CONSTRAINT IF EXISTS developers_canonical_not_self;
ALTER TABLE developers ADD CONSTRAINT developers_canonical_not_self
  CHECK (canonical_developer_id IS NULL OR canonical_developer_id <> id);

-- "Also known as" lookups, and listing only main studios.
CREATE INDEX IF NOT EXISTS idx_developers_canonical_developer_id
  ON developers (canonical_developer_id) WHERE canonical_developer_id IS NOT NULL;

-- One level only, as for games: a duplicate points straight at a main studio,
-- never at another duplicate, and a studio that others point at can't itself
-- become a duplicate. Keeps the redirect and the aliases a single lookup.
CREATE OR REPLACE FUNCTION enforce_developer_canonical_single_level()
RETURNS trigger AS $$
BEGIN
  IF NEW.canonical_developer_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM developers d
      WHERE d.id = NEW.canonical_developer_id AND d.canonical_developer_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'developer % is itself a duplicate — chains are not allowed', NEW.canonical_developer_id;
    END IF;
    IF EXISTS (SELECT 1 FROM developers d WHERE d.canonical_developer_id = NEW.id) THEN
      RAISE EXCEPTION 'developer % is the main studio for other duplicates and cannot become a duplicate', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_developer_canonical_single_level ON developers;
CREATE TRIGGER trg_enforce_developer_canonical_single_level
  BEFORE INSERT OR UPDATE OF canonical_developer_id ON developers
  FOR EACH ROW EXECUTE FUNCTION enforce_developer_canonical_single_level();

-- Future imports still find a duplicate by its igdb_id and link games to it.
-- This moves such a link onto the main studio as it's written, and drops it
-- when the main studio already has that exact link (instead of failing the
-- import on the primary key).
CREATE OR REPLACE FUNCTION game_companies_use_canonical_developer()
RETURNS trigger AS $$
DECLARE
  canon uuid;
BEGIN
  SELECT canonical_developer_id INTO canon FROM developers WHERE id = NEW.company_id;
  IF canon IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM game_companies gc
    WHERE gc.game_id = NEW.game_id AND gc.company_id = canon AND gc.role = NEW.role
  ) THEN
    RETURN NULL;
  END IF;
  NEW.company_id := canon;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_game_companies_use_canonical_developer ON game_companies;
CREATE TRIGGER trg_game_companies_use_canonical_developer
  BEFORE INSERT OR UPDATE OF company_id ON game_companies
  FOR EACH ROW EXECUTE FUNCTION game_companies_use_canonical_developer();

-- merge_developer(duplicate, main) — moves the duplicate's game links onto the
-- main studio and marks it as a duplicate, in one transaction. Studios already
-- pointing at the duplicate move to the main studio too. Safe to re-run with
-- the same arguments. Returns the number of game links moved.
CREATE OR REPLACE FUNCTION merge_developer(p_duplicate uuid, p_canonical uuid)
RETURNS integer AS $$
DECLARE
  moved integer;
BEGIN
  IF p_duplicate IS NULL OR p_canonical IS NULL THEN
    RAISE EXCEPTION 'merge_developer: both studios must exist (got % → %)', p_duplicate, p_canonical;
  END IF;
  IF p_duplicate = p_canonical THEN
    RAISE EXCEPTION 'merge_developer: a studio cannot be merged into itself (%)', p_duplicate;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM developers WHERE id = p_canonical AND canonical_developer_id IS NULL) THEN
    RAISE EXCEPTION 'merge_developer: main studio % is missing or is itself a duplicate', p_canonical;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM developers
    WHERE id = p_duplicate AND (canonical_developer_id IS NULL OR canonical_developer_id = p_canonical)
  ) THEN
    RAISE EXCEPTION 'merge_developer: studio % is missing or already merged into a different studio', p_duplicate;
  END IF;

  UPDATE developers SET canonical_developer_id = p_canonical
  WHERE canonical_developer_id = p_duplicate;

  INSERT INTO game_companies (game_id, company_id, role)
  SELECT game_id, p_canonical, role FROM game_companies WHERE company_id = p_duplicate
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS moved = ROW_COUNT;

  DELETE FROM game_companies WHERE company_id = p_duplicate;

  UPDATE developers SET canonical_developer_id = p_canonical WHERE id = p_duplicate;

  RETURN moved;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION merge_developer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_developer(uuid, uuid) TO service_role;
