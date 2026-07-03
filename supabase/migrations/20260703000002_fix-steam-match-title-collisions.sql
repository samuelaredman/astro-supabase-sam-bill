-- match_steam_games matches purely by (normalized) title, but several games
-- in the DB legitimately share an identical title — most commonly a main
-- game and its platform ports (e.g. three separate rows are all literally
-- titled "BioShock": the original PC release, a Mac port, and a PS3/Xbox
-- digital port). A single Steam library entry for "BioShock" matched all
-- three, so one sync created three duplicate library rows.
--
-- Fixed by ranking candidates per input title and keeping only the best one:
-- exact-normalized matches before fuzzy ones, then "allowed" categories
-- (main_game/expansion/standalone_expansion/remake/remaster/expanded_game —
-- kept in sync with ALLOWED_GAME_CATEGORIES in src/utils/games.ts) before
-- noise categories (port/dlc/bundle/etc.), then a deterministic id tiebreak.

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
      g.igdb_category,
      lower(regexp_replace(regexp_replace(g.title, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
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
      c.id, c.title,
      ROW_NUMBER() OVER (
        PARTITION BY c.input_title
        ORDER BY
          c.match_rank ASC,
          CASE WHEN c.igdb_category IS NULL OR c.igdb_category IN (0, 2, 4, 8, 9, 10) THEN 0 ELSE 1 END ASC,
          c.id ASC
      ) AS rn
    FROM candidates c
  )
  SELECT DISTINCT id, title
  FROM ranked
  WHERE rn = 1;
$$ LANGUAGE sql STABLE;
