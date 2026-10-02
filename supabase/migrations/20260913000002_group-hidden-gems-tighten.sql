-- Hidden Gems: tighten the floor (min 2 → 3 members) and switch to a
-- Bayesian-smoothed sort so a game with two 10s can't outrank one with five
-- 9.5s. Prior is hardcoded (mean 7, weight 3) — same signature as v1 so no
-- DROP is needed, just replace the body.

CREATE OR REPLACE FUNCTION group_hidden_gems(
  p_group_id uuid,
  p_limit int DEFAULT 5,
  p_min_group_reviews int DEFAULT 3,
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
  ORDER BY ((grp.group_count::float8 * grp.group_avg + 21.0)
            / (grp.group_count::float8 + 3.0)) DESC,
           greatest(coalesce(grs.review_count, 0) - grp.group_count, 0) ASC,
           grp.group_count DESC,
           grp.game_id
  LIMIT p_limit;
$$;
