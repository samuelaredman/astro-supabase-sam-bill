-- The previous match_steam_games fix (20260702000000) correctly solved the
-- brittle exact-match bug but introduced a severe performance regression:
-- it used a correlated EXISTS subquery, re-scanning the entire games table
-- once per Steam title (O(titles × games)). That's fine for a handful of
-- test titles but times out (Postgres error 57014, statement timeout) on any
-- real Steam library — confirmed with a 400-title batch taking 8+ seconds
-- before being killed. This is what both users hit as "Failed to match games."
--
-- Fixed by restructuring as proper JOINs (so Postgres can hash-join instead
-- of nested-loop) and adding a trigram index so the fuzzy fallback is index-
-- assisted rather than a sequential scan.

CREATE INDEX IF NOT EXISTS idx_games_title_trgm ON games USING gin (title gin_trgm_ops);

CREATE OR REPLACE FUNCTION match_steam_games(steam_titles text[])
RETURNS TABLE(id uuid, title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT
      t AS original,
      lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(steam_titles) AS t
  ),
  normalized_games AS (
    SELECT
      g.id,
      g.title,
      lower(regexp_replace(regexp_replace(g.title, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM games g
  ),
  exact_matches AS (
    SELECT ng.id, ng.title
    FROM normalized_games ng
    JOIN normalized_input ni ON ng.normalized = ni.normalized
  ),
  -- Index-assisted candidate narrowing via the `%` operator, then a precise
  -- similarity() check on the (much smaller) candidate set.
  fuzzy_matches AS (
    SELECT g.id, g.title
    FROM normalized_input ni
    JOIN games g ON g.title % ni.original
    WHERE similarity(g.title, ni.original) > 0.9
  )
  SELECT id, title FROM exact_matches
  UNION
  SELECT id, title FROM fuzzy_matches;
$$ LANGUAGE sql STABLE;
