-- What the /groups list shows on each group's card, for every listed group in
-- one call: the covers of the games the group reviews most, a few member
-- avatars, and how active it is. Covers and activity read through
-- group_reviews() with the group's genre/platform focus, so the card matches
-- the group page's own stats.

CREATE OR REPLACE FUNCTION group_card_summaries(p_group_ids uuid[])
RETURNS TABLE(
  group_id uuid,
  covers text[],
  member_avatars jsonb,
  reviews_week int,
  last_review_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH grp AS (
    SELECT id,
           nullif(stats_config->>'focus_genre_id', '')::uuid AS genre_id,
           -- The group page ignores the platform focus when a genre focus is set.
           CASE WHEN nullif(stats_config->>'focus_genre_id', '') IS NULL
                THEN nullif(stats_config->>'focus_platform_id', '')::uuid END AS platform_id
    FROM groups
    WHERE id = ANY (p_group_ids)
  )
  SELECT grp.id,
         ARRAY(
           SELECT s.cover_img_url
           FROM group_game_review_stats(grp.id, grp.genre_id, grp.platform_id) s
           WHERE s.cover_img_url IS NOT NULL
           ORDER BY s.review_count DESC, s.avg_score DESC NULLS LAST, s.game_id
           LIMIT 4
         ),
         (
           SELECT coalesce(jsonb_agg(
                    jsonb_build_object('username', m.username, 'avatar_url', m.avatar_url)
                    ORDER BY m.joined_at DESC, m.profile_id), '[]'::jsonb)
           FROM (
             SELECT p.username, p.avatar_url, gm.joined_at, gm.profile_id
             FROM group_members gm
             JOIN profiles p ON p.id = gm.profile_id
             WHERE gm.group_id = grp.id AND p.avatar_url IS NOT NULL
             ORDER BY gm.joined_at DESC, gm.profile_id
             LIMIT 4
           ) m
         ),
         act.reviews_week,
         act.last_review_at
  FROM grp
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE r.published_at > now() - interval '7 days')::int AS reviews_week,
           max(r.published_at) AS last_review_at
    FROM group_reviews(grp.id, grp.genre_id, grp.platform_id) r
  ) act;
$$;

-- Server-only, like the rest of the group stats.
REVOKE EXECUTE ON FUNCTION group_card_summaries(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_card_summaries(uuid[]) TO service_role;
