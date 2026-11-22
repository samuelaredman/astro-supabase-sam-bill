-- Urgent fix for Steam and Xbox sync being broken after 20261111000002.
--
-- Context: 20261111000002 replaced the title-based matchers with ID-based
-- ones (steam_appid against game_steam_apps, xbox_title_id against the new
-- games.xbox_title_id column). In practice both of those ID bridges are
-- nearly empty for existing chekpoint games — game_steam_apps is populated
-- only via importGameByIgdbId's persistSteamAppsFromIgdb (recent) and
-- games.xbox_title_id didn't exist at all before the migration. The IGDB
-- auto-import pass in each sync route was supposed to pick up the slack but
-- doesn't scale to a full library in one Netlify request (10s budget cap).
-- Real libraries were importing zero games.
--
-- Fix: restore the title-based matchers alongside the ID-based ones. Postgres
-- allows function overloading on arg types, so match_steam_games(text[]) and
-- match_steam_games(integer[]) coexist (same for xbox), and the caller picks
-- the right one by parameter name — PostgREST resolves by named-arg, not
-- positional. Steam becomes: appid fast path → title fallback. Xbox becomes:
-- titleId fast path → title fallback. The IGDB auto-import pass is removed
-- from both sync routes.
--
-- Depends on normalize_game_title() (20260703000003), still present.
-- Function bodies are verbatim copies of the last known-good title matchers
-- (20260909000000 for Steam; the original 20260919000002 match_xbox_games
-- for Xbox).

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

-- Xbox counterpart — restore the original title-based match_xbox_games(text[])
-- alongside the titleId-based match_xbox_games(text[]) from 20261111000002.
-- Wait — both would be text[]. For Xbox we can't rely on argument type to
-- disambiguate; drop the ID-based one first and recreate it under a different
-- name so the two coexist unambiguously. (Steam avoided this because appids
-- are integers; Xbox title_ids are strings.)
DROP FUNCTION IF EXISTS match_xbox_games(text[]);

CREATE FUNCTION match_xbox_games_by_title_id(xbox_title_ids text[])
RETURNS TABLE(id uuid, xbox_title_id text) AS $$
  SELECT g.id, g.xbox_title_id
  FROM games g
  WHERE g.xbox_title_id = ANY(xbox_title_ids);
$$ LANGUAGE sql STABLE;

CREATE FUNCTION match_xbox_games(xbox_titles text[])
RETURNS TABLE(id uuid, title text, xbox_title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT
      t AS original,
      lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(xbox_titles) AS t
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
  SELECT DISTINCT ON (id) id, title, input_title AS xbox_title
  FROM ranked
  WHERE rn = 1;
$$ LANGUAGE sql STABLE;
