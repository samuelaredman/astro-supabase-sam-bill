-- Per-game review count and score sum for the reviewed games in one genre,
-- platform or company (any role) — the genre, platform and studio hub pages.
--
-- Those pages fetched up to 500–1000 of the hub's games, then sent every one
-- of their ids back in a single `.in('game_id', …)` to get the review rows.
-- At 1000 UUIDs that URL is ~37 KB, and the request fails: /platforms/ps5
-- currently shows "0 reviews". This starts from the reviewed games and probes
-- the junction PKs, so it needs no id list, can run in parallel with the page's
-- game-list query, and returns one row per reviewed game rather than per review.
--
-- Pass exactly one of the three ids.

CREATE OR REPLACE FUNCTION hub_game_review_stats(
  p_genre_id    uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_company_id  uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, review_count int, score_sum int)
LANGUAGE sql STABLE AS $$
  SELECT s.game_id, s.review_count, s.score_sum
  FROM game_review_stats s
  WHERE (p_genre_id IS NULL OR EXISTS (
          SELECT 1 FROM game_genres x WHERE x.game_id = s.game_id AND x.genre_id = p_genre_id))
    AND (p_platform_id IS NULL OR EXISTS (
          SELECT 1 FROM game_platforms x WHERE x.game_id = s.game_id AND x.platform_id = p_platform_id))
    AND (p_company_id IS NULL OR EXISTS (
          SELECT 1 FROM game_companies x WHERE x.game_id = s.game_id AND x.company_id = p_company_id));
$$;
