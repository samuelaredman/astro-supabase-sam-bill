-- The Stats tab's stat cards: each side's games played, average rating,
-- average achievement completion, hours per game and 10s, from their reviews
-- in the group. Replaces the tale-of-the-tape columns (platform, studio, era,
-- hot takes, review length), which the tab no longer shows; the top genre
-- stays as the genre radar's fallback.
--
-- Achievement completion is per reviewed game: earned / total for that game's
-- synced set (Steam, PSN or Xbox, whichever is highest when there are several),
-- averaged over the games that have one. Games with no synced set don't count.
--
-- The return type changes, so the old function is dropped first.

DROP FUNCTION IF EXISTS group_versus_profile(uuid, uuid, uuid, uuid, uuid);

CREATE FUNCTION group_versus_profile(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  side text,
  review_count int,
  games_played int,
  avg_score float8,
  top_genre text, top_genre_count int,
  avg_hours float8,
  tens int,
  avg_achievement_pct float8,
  achievement_games int
)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT CASE WHEN gr.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
           gr.profile_id, gr.game_id, gr.score, gr.play_time_hours
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) gr
    WHERE p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id)
  ), base AS (
    SELECT r.side,
           count(*)::int AS review_count,
           count(DISTINCT r.game_id)::int AS games_played,
           avg(r.score)::float8 AS avg_score,
           avg(r.play_time_hours) FILTER (WHERE r.play_time_hours > 0)::float8 AS avg_hours,
           count(*) FILTER (WHERE r.score = 10)::int AS tens
    FROM r
    GROUP BY r.side
  ), ach AS (
    -- One completion per review that has a synced set, 0..1
    SELECT r.side, greatest(st.pct, ps.pct, xb.pct) AS pct
    FROM r
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE a.unlocked))::float8 / count(*) AS pct
      FROM user_achievements a
      WHERE a.profile_id = r.profile_id AND a.game_id = r.game_id
      HAVING count(*) > 0
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE t.earned))::float8 / count(*) AS pct
      FROM user_trophies t
      WHERE t.profile_id = r.profile_id AND t.game_id = r.game_id
      HAVING count(*) > 0
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE x.unlocked))::float8 / count(*) AS pct
      FROM user_xbox_achievements x
      WHERE x.profile_id = r.profile_id AND x.game_id = r.game_id
      HAVING count(*) > 0
    ) xb ON true
    WHERE st.pct IS NOT NULL OR ps.pct IS NOT NULL OR xb.pct IS NOT NULL
  ), ach_side AS (
    SELECT side, avg(pct)::float8 AS avg_pct, count(*)::int AS n
    FROM ach
    GROUP BY side
  ), genre AS (
    SELECT DISTINCT ON (r.side) r.side, gn.name, count(*)::int AS n
    FROM r
    JOIN game_genres gg ON gg.game_id = r.game_id
    JOIN genres gn ON gn.id = gg.genre_id
    GROUP BY r.side, gn.name
    ORDER BY r.side, count(*) DESC, gn.name
  )
  SELECT sd.side,
         coalesce(b.review_count, 0),
         coalesce(b.games_played, 0),
         b.avg_score,
         ge.name, ge.n,
         b.avg_hours,
         coalesce(b.tens, 0),
         a.avg_pct,
         coalesce(a.n, 0)
  FROM unnest(ARRAY['subject', 'other']) AS sd(side)
  LEFT JOIN base b ON b.side = sd.side
  LEFT JOIN genre ge ON ge.side = sd.side
  LEFT JOIN ach_side a ON a.side = sd.side;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_versus_profile(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_versus_profile(uuid, uuid, uuid, uuid, uuid) TO service_role;
