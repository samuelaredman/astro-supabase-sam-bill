-- The strict platform JOIN in match_psn_games (migration 20261127000001) was
-- rejecting legit matches whenever the Chekpoint games row for a title
-- happened to be imported with a different PS edition tagged than the user's
-- PSN platform: e.g. "Marvel's Spider-Man" tagged PS5 in games (because only
-- the Remastered was imported) + user's PSN npCommId for the 2018 PS4
-- original → strict `p.igdb_id = u.plat_igdb` JOIN drops the match, even
-- though the user obviously has "Marvel's Spider-Man" in their library.
--
-- Fix: demote the platform match from a hard JOIN to a tiebreaker in the
-- ORDER BY. Title + date-bound stay required (date-DESC still picks the
-- 2016 Ratchet remake over the 2002 PS2 original — the thing the platform
-- filter was originally meant to solve). Platform match just breaks ties
-- when multiple titled-date-bounded candidates survive.

DROP FUNCTION IF EXISTS match_psn_games(text[], int[], text[], timestamptz[]);

CREATE OR REPLACE FUNCTION match_psn_games(
  psn_titles text[],
  psn_platform_igdb_ids int[],
  psn_np_comm_ids text[],
  psn_last_updated timestamptz[]
)
RETURNS TABLE(input_index int, game_id uuid, matched_by text) AS $$
  WITH inputs AS (
    SELECT (ord - 1)::int AS input_index, title, plat_igdb, npc, last_upd
    FROM unnest(psn_titles, psn_platform_igdb_ids, psn_np_comm_ids, psn_last_updated)
         WITH ORDINALITY AS u(title, plat_igdb, npc, last_upd, ord)
  ),
  by_id AS (
    SELECT i.input_index, g.id AS game_id, 'id'::text AS matched_by
    FROM inputs i
    JOIN games g ON g.psn_np_communication_id = i.npc
  ),
  unmatched AS (
    SELECT i.* FROM inputs i
    WHERE NOT EXISTS (SELECT 1 FROM by_id b WHERE b.input_index = i.input_index)
  ),
  -- Candidates: title + date bound only (NO platform JOIN). Platform is
  -- available via a LEFT JOIN so we can rank candidates with a matching
  -- platform above those without, but we don't drop the no-platform-match
  -- ones.
  by_title AS (
    SELECT DISTINCT ON (u.input_index)
           u.input_index,
           g.id AS game_id,
           'title_date'::text AS matched_by
    FROM unmatched u
    JOIN games g
      ON normalize_title_for_match(g.title) = normalize_title_for_match(u.title)
    LEFT JOIN LATERAL (
      SELECT 1 AS platform_match
      FROM game_platforms gp
      JOIN platforms p ON p.id = gp.platform_id
      WHERE gp.game_id = g.id AND p.igdb_id = u.plat_igdb
      LIMIT 1
    ) pm ON true
    WHERE g.date_released IS NULL
       OR u.last_upd IS NULL
       OR g.date_released <= u.last_upd::date
    ORDER BY u.input_index,
             -- Platform-matched candidates win tiebreakers.
             (pm.platform_match IS NOT NULL) DESC,
             -- Then most recent release (handles Ratchet remake vs original).
             g.date_released DESC NULLS LAST
  )
  SELECT * FROM by_id
  UNION ALL
  SELECT * FROM by_title;
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';
