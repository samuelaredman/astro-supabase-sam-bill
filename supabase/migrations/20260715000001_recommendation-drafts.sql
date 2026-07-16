-- ─────────────────────────────────────────────────────────────────────────────
--  Recommendation drafts: a recommendation can now be saved as a draft (both games
--  chosen, body optional) and published later. Adds a `status` column mirroring the
--  reviews model, and makes the "one recommendation per author per directional game
--  pair" uniqueness apply only to PUBLISHED rows so a draft can coexist with (or be
--  a not-yet-posted duplicate of) a published recommendation.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. status column
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

ALTER TABLE recommendations
  DROP CONSTRAINT IF EXISTS recommendations_status_check;
ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_status_check CHECK (status IN ('published', 'draft'));

-- 2. Replace the full unique constraint with a partial unique index (published only).
--    The original constraint was created inline in the CREATE TABLE, so its name is
--    Postgres-generated — discover and drop it by its columns rather than assuming a name.
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'recommendations'::regclass
    AND con.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(con.conkey) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
    ) = ARRAY['profile_id', 'source_game_id', 'target_game_id']::text[];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE recommendations DROP CONSTRAINT %I', cname);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS recommendations_published_pair_uniq
  ON recommendations (profile_id, source_game_id, target_game_id)
  WHERE status = 'published';

-- 3. Index to back the per-user drafts query
CREATE INDEX IF NOT EXISTS recommendations_profile_status_idx
  ON recommendations (profile_id, status);
