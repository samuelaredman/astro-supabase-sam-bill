-- match_steam_games only returned the Chekpoint game (id + our title). But
-- steam/import.ts then looks up playtime + appid from maps keyed by the *Steam*
-- title, using our title as the key. Whenever a match came from normalization or
-- the trigram fallback (roman numerals, "&"/"and", trademark symbols, near-exact
-- typos) the two titles are not byte-equal, so the lookup missed and the game
-- was imported/updated with steam_playtime_minutes = 0 and steam_appid = NULL.
-- That's why e.g. "Blasphemous II" (our title) / "Blasphemous 2" (Steam) synced
-- with no hours and never showed as Steam-linked.
--
-- Fix: also return the matched input title (`steam_title`) so the caller can key
-- the playtime/appid lookup off the value Steam actually sent. `input_title` is
-- already carried through the CTEs; this just projects it.

CREATE OR REPLACE FUNCTION match_steam_games(steam_titles text[])
RETURNS TABLE(id uuid, title text, steam_title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT
      t AS original,
      normalize_game_title(t) AS normalized
    FROM unnest(steam_titles) AS t
  ),
  normalized_games AS (
    SELECT
      g.id,
      g.title,
      g.igdb_category,
      normalize_game_title(g.title) AS normalized
    FROM games g
  ),
  candidates AS (
    SELECT ni.original AS input_title, ng.id, ng.title, ng.igdb_category, 0 AS match_rank
    FROM normalized_games ng
    JOIN normalized_input ni ON ng.normalized = ni.normalized
    UNION ALL
    SELECT ni.original AS input_title, g.id, g.title, g.igdb_category, 1 AS match_rank
    FROM normalized_input ni
    JOIN games g ON g.title % ni.original
    WHERE similarity(g.title, ni.original) > 0.9
  ),
  ranked AS (
    SELECT
      c.input_title, c.id, c.title,
      ROW_NUMBER() OVER (
        PARTITION BY c.input_title
        ORDER BY
          c.match_rank ASC,
          CASE WHEN c.igdb_category IS NULL OR c.igdb_category IN (0, 2, 4, 8, 9, 10) THEN 0 ELSE 1 END ASC,
          c.id ASC
      ) AS rn
    FROM candidates c
  )
  SELECT DISTINCT id, title, input_title AS steam_title
  FROM ranked
  WHERE rn = 1;
$$ LANGUAGE sql STABLE;
