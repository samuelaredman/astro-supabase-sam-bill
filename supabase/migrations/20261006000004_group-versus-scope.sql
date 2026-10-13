-- The Stats tab's tab-wide filters: "Games" (all, shared, disagree, agree)
-- and "Genre" narrow every stat on the tab, not just the games list. Genre
-- already works through each function's p_genre_id; this adds the scope.
--
-- group_versus_scope() gives the games in a scope:
-- - shared: the subject and the other side (at least p_min_reviews of it)
--   both reviewed
-- - disagree / agree: shared, more than / at most a point apart — the same
--   gap as VERSUS_AGREE_GAP in src/utils/groupCompare.ts
-- The profile, genres and summary functions take p_scope (default 'all',
-- which is what they did before) and count only reviews of games in it.
-- group_versus_score_distribution() is new: each side's scores, for the
-- histogram, under the same filters.
--
-- Adding parameters changes the signatures, so the old functions are dropped
-- first. Every new parameter has a default, so calls without them still work.

CREATE OR REPLACE FUNCTION group_versus_scope(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid,
  p_genre_id uuid,
  p_platform_id uuid,
  p_scope text,
  p_min_reviews int
)
RETURNS TABLE(game_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT v.game_id
  FROM group_versus_games(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id) v
  WHERE v.subject_score IS NOT NULL
    AND v.other_count >= p_min_reviews
    AND (p_scope = 'shared'
         OR (p_scope = 'disagree' AND v.diff_abs > 1)
         OR (p_scope = 'agree' AND v.diff_abs <= 1));
$$;

DROP FUNCTION IF EXISTS group_versus_profile(uuid, uuid, uuid, uuid, uuid);
CREATE FUNCTION group_versus_profile(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'all',
  p_min_reviews int DEFAULT 1
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
    WHERE (p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id))
      AND (p_scope = 'all' OR gr.game_id IN (
        SELECT s.game_id FROM group_versus_scope(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id, p_scope, p_min_reviews) s))
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

DROP FUNCTION IF EXISTS group_versus_genres(uuid, uuid, uuid, uuid, uuid, int);
CREATE FUNCTION group_versus_genres(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_limit int DEFAULT 8,
  p_scope text DEFAULT 'all',
  p_min_reviews int DEFAULT 1
)
RETURNS TABLE(side text, genre text, review_count int)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT CASE WHEN gr.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
           gr.game_id
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) gr
    WHERE (p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id))
      AND (p_scope = 'all' OR gr.game_id IN (
        SELECT s.game_id FROM group_versus_scope(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id, p_scope, p_min_reviews) s))
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

DROP FUNCTION IF EXISTS group_versus_summary(uuid, uuid, uuid, uuid, uuid, int);
CREATE FUNCTION group_versus_summary(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_min_reviews int DEFAULT 1,
  p_scope text DEFAULT 'all'
)
RETURNS TABLE(
  shared_games int,
  subject_avg float8,
  other_avg float8,
  mean_abs_diff float8,
  within_one int,
  above int,
  below int,
  level int
)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int,
         avg(v.subject_score)::float8,
         avg(v.other_avg)::float8,
         avg(v.diff_abs)::float8,
         count(*) FILTER (WHERE v.diff_abs <= 1)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) > 0)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) < 0)::int,
         count(*) FILTER (WHERE round(v.diff::numeric, 1) = 0)::int
  FROM group_versus_games(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id) v
  WHERE v.subject_score IS NOT NULL
    AND v.other_count >= p_min_reviews
    AND (p_scope IN ('all', 'shared')
         OR (p_scope = 'disagree' AND v.diff_abs > 1)
         OR (p_scope = 'agree' AND v.diff_abs <= 1));
$$;

-- Each side's reviews at each score: the subject's, and the other side's (one
-- member, or every other member pooled).
CREATE OR REPLACE FUNCTION group_versus_score_distribution(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'all',
  p_min_reviews int DEFAULT 1
)
RETURNS TABLE(side text, score int, review_count int)
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN gr.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
         gr.score,
         count(*)::int
  FROM group_reviews(p_group_id, p_genre_id, p_platform_id) gr
  WHERE (p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id))
    AND (p_scope = 'all' OR gr.game_id IN (
      SELECT s.game_id FROM group_versus_scope(p_group_id, p_profile_id, p_other_id, p_genre_id, p_platform_id, p_scope, p_min_reviews) s))
  GROUP BY 1, 2;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION
  group_versus_scope(uuid, uuid, uuid, uuid, uuid, text, int),
  group_versus_profile(uuid, uuid, uuid, uuid, uuid, text, int),
  group_versus_genres(uuid, uuid, uuid, uuid, uuid, int, text, int),
  group_versus_summary(uuid, uuid, uuid, uuid, uuid, int, text),
  group_versus_score_distribution(uuid, uuid, uuid, uuid, uuid, text, int)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  group_versus_scope(uuid, uuid, uuid, uuid, uuid, text, int),
  group_versus_profile(uuid, uuid, uuid, uuid, uuid, text, int),
  group_versus_genres(uuid, uuid, uuid, uuid, uuid, int, text, int),
  group_versus_summary(uuid, uuid, uuid, uuid, uuid, int, text),
  group_versus_score_distribution(uuid, uuid, uuid, uuid, uuid, text, int)
TO service_role;
