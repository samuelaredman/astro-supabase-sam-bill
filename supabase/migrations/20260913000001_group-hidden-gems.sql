-- Hidden Gems: games the group rates highly that few outside the group have
-- reviewed. community_count is site-wide minus the group's own reviews, so a
-- game whose only reviews come from the group scores 0 and lands top.
--
-- Reads community counts from the game_review_stats view (migration
-- 20260911000000), so the scaling swap to a table (see CLAUDE.md) still covers
-- this without changes here.

CREATE OR REPLACE FUNCTION group_hidden_gems(
  p_group_id uuid,
  p_limit int DEFAULT 5,
  p_min_group_reviews int DEFAULT 2,
  p_min_group_avg float8 DEFAULT 8.0,
  p_max_community_reviews int DEFAULT 20,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  group_count int, group_avg float8,
  community_count int
)
LANGUAGE sql STABLE AS $$
  WITH grp AS (
    SELECT r.game_id,
           count(*)::int AS group_count,
           avg(r.score)::float8 AS group_avg
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    GROUP BY r.game_id
    HAVING count(*) >= p_min_group_reviews AND avg(r.score) >= p_min_group_avg
  )
  SELECT gm.id, gm.title, gm.slug, gm.cover_img_url,
         grp.group_count, grp.group_avg,
         greatest(coalesce(grs.review_count, 0) - grp.group_count, 0)::int AS community_count
  FROM grp
  JOIN games gm ON gm.id = grp.game_id
  LEFT JOIN game_review_stats grs ON grs.game_id = grp.game_id
  WHERE greatest(coalesce(grs.review_count, 0) - grp.group_count, 0) <= p_max_community_reviews
  ORDER BY grp.group_avg DESC,
           greatest(coalesce(grs.review_count, 0) - grp.group_count, 0) ASC,
           grp.group_count DESC,
           grp.game_id
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION
  group_hidden_gems(uuid, int, int, float8, int, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_hidden_gems(uuid, int, int, float8, int, uuid, uuid)
TO service_role;
