-- match_steam_games previously required an exact (lowercased) string match,
-- which silently fails on trademark symbols Steam appends (™/®/©) and on any
-- minor punctuation/whitespace difference from the IGDB-sourced title —
-- disproportionately breaking numbered sequels (e.g. "Mega Man X2") where one
-- entry in a series differs by a single character from its Steam listing.
-- Now normalizes both sides (strip trademark symbols, collapse whitespace,
-- lowercase) and falls back to trigram similarity for near-exact matches,
-- mirroring the approach search_games already uses for the same reason.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION match_steam_games(steam_titles text[])
RETURNS TABLE(id uuid, title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(steam_titles) AS t
  )
  SELECT g.id, g.title
  FROM games g
  WHERE EXISTS (
    SELECT 1 FROM normalized_input ni
    WHERE lower(regexp_replace(regexp_replace(g.title, '[™®©]', '', 'g'), '\s+', ' ', 'g')) = ni.normalized
       OR similarity(
            lower(regexp_replace(regexp_replace(g.title, '[™®©]', '', 'g'), '\s+', ' ', 'g')),
            ni.normalized
          ) > 0.9
  );
$$ LANGUAGE sql STABLE;
