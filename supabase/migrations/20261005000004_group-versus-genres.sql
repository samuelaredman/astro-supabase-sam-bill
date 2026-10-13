-- The Stats tab's genre radar: how many of each side's reviews fall in each
-- genre, for the subject and the other side (one member, or the community —
-- every other member, pooled). The page picks the axes from both sides' top
-- genres and plots each side's share of its own reviews.
--
-- Up to p_limit genres per side, most reviewed first. A game in two genres
-- counts towards both. Reads through group_reviews() like the other group_*
-- functions.

CREATE OR REPLACE FUNCTION group_versus_genres(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_limit int DEFAULT 8
)
RETURNS TABLE(side text, genre text, review_count int)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT CASE WHEN gr.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
           gr.game_id
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) gr
    WHERE p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id)
  ), counted AS (
    SELECT r.side, gn.name AS genre, count(*)::int AS review_count,
           row_number() OVER (PARTITION BY r.side ORDER BY count(*) DESC, gn.name) AS rank
    FROM r
    JOIN game_genres gg ON gg.game_id = r.game_id
    JOIN genres gn ON gn.id = gg.genre_id
    GROUP BY r.side, gn.name
  )
  SELECT side, genre, review_count
  FROM counted
  WHERE rank <= p_limit
  ORDER BY side, rank;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_versus_genres(uuid, uuid, uuid, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_versus_genres(uuid, uuid, uuid, uuid, uuid, int) TO service_role;
