-- Make the matcher strictly-additive relative to the pre-id-only matcher.
-- Previously the date bound was a WHERE clause: candidates with
-- date_released > user's trophy-earn date were dropped entirely. That could
-- silently reject legit matches whenever games.date_released is wrong,
-- missing, or inconsistent with PSN's lastUpdatedDateTime.
--
-- Guarantee we want: every title the pre-id-only matcher (db465f4) would
-- have found, this matcher also finds. We just pick more intelligently when
-- there are multiple candidates. Date and platform become preferences in the
-- ORDER BY — ranking candidates — rather than filters that drop them.
--
-- Multi-edition disambiguation still works: Ratchet & Clank (2016 PS4
-- remake) still wins over the 2002 PS2 original because platform-match
-- comes first in the sort and then date_released DESC breaks remaining
-- ties. Old matcher's arbitrary `ORDER BY id ASC` tiebreaker is replaced
-- with deterministic, correctness-biased ordering.

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
  -- Candidate set: ONLY gated on normalized title. Everything else is
  -- an ordering preference. No WHERE clause can silently drop a match
  -- that the old (title-only) matcher would have surfaced.
  by_title AS (
    SELECT DISTINCT ON (u.input_index)
           u.input_index,
           g.id AS game_id,
           'title'::text AS matched_by
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
    ORDER BY u.input_index,
             -- Prefer candidates whose platforms include the user's PSN platform.
             (pm.platform_match IS NOT NULL) DESC,
             -- Prefer candidates whose release date is on or before the user's
             -- trophy earn date (a necessary condition in reality; nulls on
             -- either side can't disprove it, so they tie with real matches).
             (g.date_released IS NULL
              OR u.last_upd IS NULL
              OR g.date_released <= u.last_upd::date) DESC,
             -- Newest release breaks remaining ties (Ratchet remake wins
             -- over the PS2 original when both are candidates).
             g.date_released DESC NULLS LAST
  )
  SELECT * FROM by_id
  UNION ALL
  SELECT * FROM by_title;
$$ LANGUAGE sql STABLE;

NOTIFY pgrst, 'reload schema';
