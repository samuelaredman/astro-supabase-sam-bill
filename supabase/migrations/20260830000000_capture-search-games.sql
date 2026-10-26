-- ─────────────────────────────────────────────────────────────────────────────
--  Phase 0 capture — search_games()
--
--  search_games() predates migration tracking (it was created directly against
--  the database, so its definition never lived in this repo). This migration
--  captures the CURRENT live definition verbatim — via pg_get_functiondef — so
--  it is under source control before Phase 5 alters it to filter on canonical
--  reviewable nodes.
--
--  Applying this against the existing database is a no-op: the definition is
--  byte-for-byte what already runs. Do NOT change behavior here — this is a
--  faithful snapshot only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_games(
  search_query text,
  genre_id uuid DEFAULT NULL::uuid,
  platform_id uuid DEFAULT NULL::uuid,
  result_limit integer DEFAULT 12
)
 RETURNS TABLE(id uuid, title text, slug text, cover_img_url text, date_released date, sim double precision)
 LANGUAGE sql
AS $function$
  SELECT DISTINCT g.id, g.title, g.slug, g.cover_img_url, g.date_released,
    GREATEST(
      CASE WHEN lower(g.title) = lower(search_query) THEN 1.0 ELSE 0.0 END,
      CASE WHEN lower(g.title) LIKE lower(search_query) || '%' THEN 0.9 ELSE 0.0 END,
      CASE WHEN lower(g.title) LIKE '%' || lower(search_query) || '%' THEN 0.8 ELSE 0.0 END,
      similarity(g.title, search_query),
      ts_rank(g.title_search, websearch_to_tsquery('english', search_query))::float
    ) AS sim
  FROM games g
  WHERE (
    lower(g.title) = lower(search_query)
    OR lower(g.title) LIKE lower(search_query) || '%'
    OR lower(g.title) LIKE '%' || lower(search_query) || '%'
    OR g.title_search @@ websearch_to_tsquery('english', search_query)
    OR similarity(g.title, search_query) > 0.3
  )
  AND (
    genre_id IS NULL
    OR EXISTS (
      SELECT 1 FROM game_genres gg WHERE gg.game_id = g.id AND gg.genre_id = search_games.genre_id
    )
  )
  AND (
    platform_id IS NULL
    OR EXISTS (
      SELECT 1 FROM game_platforms gp WHERE gp.game_id = g.id AND gp.platform_id = search_games.platform_id
    )
  )
  ORDER BY sim DESC
  LIMIT result_limit;
$function$;
