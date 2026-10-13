-- The Stats tab's game face-offs: for each game on the lists, each side's
-- hours, achievement completion and platform, next to the scores that
-- group_versus_games already gives.
--
-- Called with only the games the lists show (fifteen at most), so it stays
-- small however big the group is. Reads through group_reviews() like the
-- other group_* functions.
--
-- Per side and game:
-- - review_count: the side's reviews of the game (the community's can be many)
-- - avg_hours: average play_time_hours over reviews that logged some
-- - avg_achievement_pct: earned / total for the game's synced set (Steam, PSN
--   or Xbox, whichever is highest), averaged over the side's people who have
--   one. The subject, and a picked member, count even without a review, so
--   "loves, you haven't reviewed" can still show how far you got.
-- - top_platform: the platform the side's reviews say they played on most

CREATE OR REPLACE FUNCTION group_versus_game_details(
  p_group_id uuid,
  p_profile_id uuid,
  p_game_ids uuid[],
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid,
  side text,
  review_count int,
  avg_hours float8,
  hours_count int,
  avg_achievement_pct float8,
  achievement_count int,
  top_platform text
)
LANGUAGE sql STABLE AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_game_ids) AS game_id
  ), gr AS (
    SELECT CASE WHEN r.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
           r.game_id, r.profile_id, r.play_time_hours, r.platform_played_on
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
    WHERE r.game_id = ANY(p_game_ids)
      AND (p_other_id IS NULL OR r.profile_id IN (p_profile_id, p_other_id))
  ), people AS (
    SELECT side, profile_id, game_id FROM gr
    UNION
    SELECT 'subject', p_profile_id, game_id FROM ids
    UNION
    SELECT 'other', p_other_id, game_id FROM ids WHERE p_other_id IS NOT NULL
  ), ach AS (
    SELECT pe.side, pe.game_id, greatest(st.pct, ps.pct, xb.pct) AS pct
    FROM people pe
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE a.unlocked))::float8 / count(*) AS pct
      FROM user_achievements a
      WHERE a.profile_id = pe.profile_id AND a.game_id = pe.game_id
      HAVING count(*) > 0
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE t.earned))::float8 / count(*) AS pct
      FROM user_trophies t
      WHERE t.profile_id = pe.profile_id AND t.game_id = pe.game_id
      HAVING count(*) > 0
    ) ps ON true
    LEFT JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE x.unlocked))::float8 / count(*) AS pct
      FROM user_xbox_achievements x
      WHERE x.profile_id = pe.profile_id AND x.game_id = pe.game_id
      HAVING count(*) > 0
    ) xb ON true
    WHERE st.pct IS NOT NULL OR ps.pct IS NOT NULL OR xb.pct IS NOT NULL
  ), ach_agg AS (
    SELECT side, game_id, avg(pct)::float8 AS avg_pct, count(*)::int AS n
    FROM ach
    GROUP BY side, game_id
  ), rev AS (
    SELECT side, game_id,
           count(*)::int AS n,
           avg(play_time_hours) FILTER (WHERE play_time_hours > 0)::float8 AS avg_hours,
           count(*) FILTER (WHERE play_time_hours > 0)::int AS hours_n
    FROM gr
    GROUP BY side, game_id
  ), plat AS (
    SELECT DISTINCT ON (gr.side, gr.game_id) gr.side, gr.game_id, p.name
    FROM gr
    JOIN platforms p ON p.id = gr.platform_played_on
    GROUP BY gr.side, gr.game_id, p.name
    ORDER BY gr.side, gr.game_id, count(*) DESC, p.name
  )
  SELECT ids.game_id, sd.side,
         coalesce(rv.n, 0),
         rv.avg_hours,
         coalesce(rv.hours_n, 0),
         ac.avg_pct,
         coalesce(ac.n, 0),
         pl.name
  FROM ids
  CROSS JOIN unnest(ARRAY['subject', 'other']) AS sd(side)
  LEFT JOIN rev rv ON rv.side = sd.side AND rv.game_id = ids.game_id
  LEFT JOIN ach_agg ac ON ac.side = sd.side AND ac.game_id = ids.game_id
  LEFT JOIN plat pl ON pl.side = sd.side AND pl.game_id = ids.game_id;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_versus_game_details(uuid, uuid, uuid[], uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_versus_game_details(uuid, uuid, uuid[], uuid, uuid, uuid) TO service_role;
