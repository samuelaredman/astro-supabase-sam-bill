-- Steam library import matches owned games by title. Diacritics still broke
-- that match: Steam strips them for display ("Okami HD") while our IGDB-sourced
-- rows keep them ("Ōkami HD"), so a user who synced Steam saw achievements
-- flow in (keyed on steam_appid) but the game itself never joined their
-- library. Add an unaccent() step to normalize_game_title so the two titles
-- collapse to the same string before the exact / trigram comparisons run.
--
-- unaccent is already installed (20260714000000_enable-unaccent-extension.sql);
-- IMMUTABLE wrapper via regexp_replace alternative is unnecessary since
-- normalize_game_title is only called in match_steam_games (runtime, no index),
-- but we keep IMMUTABLE anyway in case a future caller wants to index on it.
--
-- unaccent is STABLE, so we lose the IMMUTABLE marker — but the function is
-- never used in an index, only in CTEs evaluated per query, so STABLE is fine.

CREATE OR REPLACE FUNCTION normalize_game_title(input text)
RETURNS text AS $$
  WITH t0  AS (SELECT unaccent(regexp_replace(input, '[™®©]', '', 'g')) AS t),
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
$$ LANGUAGE sql STABLE;
