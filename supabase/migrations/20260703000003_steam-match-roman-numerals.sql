-- Steam and our IGDB-sourced titles disagree on a few common formatting
-- conventions:
--   - Roman vs Arabic numerals ("Baldur's Gate III" vs Steam's "Baldur's
--     Gate 3", "Divinity: Original Sin II" vs "...2")
--   - "&" vs "and" ("Rabbit & Steel" vs Steam's "Rabbit and Steel")
-- Trigram similarity treats these as completely different tokens (an "&"
-- swap moves way more than one character), so both fell through the exact
-- and fuzzy match paths in match_steam_games.
--
-- Extracted the normalization into its own function (was inlined twice in
-- match_steam_games) since it now needs these extra steps on top of the
-- existing trademark-symbol stripping and whitespace collapsing.

-- Longest numerals first so e.g. "XIII" isn't partially eaten by the "X" or
-- "I" rules before it gets a chance to match as a whole word. Each step
-- reads the previous step's output — much easier to verify than nesting
-- 20 regexp_replace() calls nested inside each other.
CREATE OR REPLACE FUNCTION normalize_game_title(input text)
RETURNS text AS $$
  WITH t0  AS (SELECT regexp_replace(input, '[™®©]', '', 'g') AS t),
       tamp AS (SELECT regexp_replace(t, '\s*&\s*', ' and ', 'g') AS t FROM t0),
       t1  AS (SELECT regexp_replace(t, '\mXX\M',    '20', 'g') AS t FROM tamp),
       t2  AS (SELECT regexp_replace(t, '\mXIX\M',   '19', 'g') AS t FROM t1),
       t3  AS (SELECT regexp_replace(t, '\mXVIII\M', '18', 'g') AS t FROM t2),
       t4  AS (SELECT regexp_replace(t, '\mXVII\M',  '17', 'g') AS t FROM t3),
       t5  AS (SELECT regexp_replace(t, '\mXVI\M',   '16', 'g') AS t FROM t4),
       t6  AS (SELECT regexp_replace(t, '\mXV\M',    '15', 'g') AS t FROM t5),
       t7  AS (SELECT regexp_replace(t, '\mXIV\M',   '14', 'g') AS t FROM t6),
       t8  AS (SELECT regexp_replace(t, '\mXIII\M',  '13', 'g') AS t FROM t7),
       t9  AS (SELECT regexp_replace(t, '\mXII\M',   '12', 'g') AS t FROM t8),
       t10 AS (SELECT regexp_replace(t, '\mXI\M',    '11', 'g') AS t FROM t9),
       t11 AS (SELECT regexp_replace(t, '\mX\M',     '10', 'g') AS t FROM t10),
       t12 AS (SELECT regexp_replace(t, '\mIX\M',    '9',  'g') AS t FROM t11),
       t13 AS (SELECT regexp_replace(t, '\mVIII\M',  '8',  'g') AS t FROM t12),
       t14 AS (SELECT regexp_replace(t, '\mVII\M',   '7',  'g') AS t FROM t13),
       t15 AS (SELECT regexp_replace(t, '\mVI\M',    '6',  'g') AS t FROM t14),
       t16 AS (SELECT regexp_replace(t, '\mV\M',     '5',  'g') AS t FROM t15),
       t17 AS (SELECT regexp_replace(t, '\mIV\M',    '4',  'g') AS t FROM t16),
       t18 AS (SELECT regexp_replace(t, '\mIII\M',   '3',  'g') AS t FROM t17),
       t19 AS (SELECT regexp_replace(t, '\mII\M',    '2',  'g') AS t FROM t18),
       t20 AS (SELECT regexp_replace(t, '\mI\M',     '1',  'g') AS t FROM t19),
       t21 AS (SELECT regexp_replace(t, '\s+',       ' ',  'g') AS t FROM t20)
  SELECT lower(t) FROM t21;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION match_steam_games(steam_titles text[])
RETURNS TABLE(id uuid, title text) AS $$
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
