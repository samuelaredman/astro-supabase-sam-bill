-- ─────────────────────────────────────────────────────────────────────────────
--  Phase 0 capture — match_steam_games()
--
--  Captures the CURRENT live definition verbatim (via pg_get_functiondef) so it
--  is under source control before Phase 7 reworks it to match on Steam appid
--  first and resolve hits to their canonical node. Applying against the existing
--  database is a no-op — this is a faithful snapshot only.
--
--  Depends on normalize_game_title() (migration 20260703000003), which is
--  unchanged. The `IN (0, 2, 4, 8, 9, 10)` category tiebreak here mirrors the
--  legacy ALLOWED_GAME_CATEGORIES; Phase 7 replaces it with canonical resolution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.match_steam_games(steam_titles text[])
 RETURNS TABLE(id uuid, title text)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;
