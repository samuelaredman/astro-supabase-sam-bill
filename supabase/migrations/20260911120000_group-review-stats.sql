-- Group page stats, computed in Postgres.
--
-- The group pages fetched every published review by every member (all member
-- ids passed to `.in()`) and added them up in JS. Supabase caps a response at
-- 1000 rows without an error, so from roughly 150 active members the review
-- count, average and hours came out low, and a long enough id list fails
-- outright on request-URL length. The genre focus had the same problem: it
-- `.in()`-ed every game id in the genre, which is thousands for "Adventure".
--
-- Every function reads through group_reviews(), so "published, by a current
-- member, inside the group's genre/platform focus" is defined once.

CREATE OR REPLACE FUNCTION group_reviews(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS SETOF reviews
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM group_members gm
  JOIN reviews r ON r.profile_id = gm.profile_id
  WHERE gm.group_id = p_group_id
    AND r.status = 'published'
    AND (p_genre_id IS NULL OR EXISTS (
      SELECT 1 FROM game_genres gg WHERE gg.game_id = r.game_id AND gg.genre_id = p_genre_id))
    AND (p_platform_id IS NULL OR EXISTS (
      SELECT 1 FROM game_platforms gp WHERE gp.game_id = r.game_id AND gp.platform_id = p_platform_id));
$$;

-- Header totals: reviews, distinct games, average score, hours played.
CREATE OR REPLACE FUNCTION group_review_summary(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(review_count int, game_count int, avg_score float8, hours_sum int)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int,
         count(DISTINCT game_id)::int,
         avg(score)::float8,
         coalesce(sum(play_time_hours), 0)::int
  FROM group_reviews(p_group_id, p_genre_id, p_platform_id);
$$;

-- One row per member with at least one review: Critic Spectrum and The Range.
CREATE OR REPLACE FUNCTION group_member_review_stats(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(profile_id uuid, review_count int, avg_score float8)
LANGUAGE sql STABLE AS $$
  SELECT profile_id, count(*)::int, avg(score)::float8
  FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
  GROUP BY profile_id;
$$;

-- One row per game the group has reviewed, with the game's display fields so
-- callers can .order()/.limit() it without a second lookup. Most Played, Top
-- Rated, and the Stats tab's shared games.
CREATE OR REPLACE FUNCTION group_game_review_stats(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  review_count int, avg_score float8, min_score int, max_score int
)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         s.review_count, s.avg_score, s.min_score, s.max_score
  FROM (
    SELECT game_id,
           count(*)::int AS review_count,
           avg(score)::float8 AS avg_score,
           min(score) AS min_score,
           max(score) AS max_score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
    GROUP BY game_id
  ) s
  JOIN games g ON g.id = s.game_id;
$$;

-- Each member's score on the given games: the Stats tab's comparison rows.
CREATE OR REPLACE FUNCTION group_game_member_scores(p_group_id uuid, p_game_ids uuid[])
RETURNS TABLE(game_id uuid, profile_id uuid, score int)
LANGUAGE sql STABLE AS $$
  SELECT r.game_id, r.profile_id, r.score
  FROM group_reviews(p_group_id) r
  WHERE r.game_id = ANY (p_game_ids);
$$;

-- Split Decision: the game two members disagree on most, and those two members.
-- Ties go to the game more members reviewed; no row when nobody disagrees.
CREATE OR REPLACE FUNCTION group_split_decision(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, spread int,
  high_profile_id uuid, high_score int,
  low_profile_id uuid, low_score int
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT game_id, profile_id, score, published_at
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
  ), widest AS (
    SELECT game_id, max(score) - min(score) AS spread
    FROM gr
    GROUP BY game_id
    HAVING max(score) > min(score)
    ORDER BY max(score) - min(score) DESC, count(*) DESC, game_id
    LIMIT 1
  )
  SELECT w.game_id, w.spread, hi.profile_id, hi.score, lo.profile_id, lo.score
  FROM widest w
  CROSS JOIN LATERAL (
    SELECT profile_id, score FROM gr WHERE gr.game_id = w.game_id
    ORDER BY score DESC, published_at, profile_id LIMIT 1
  ) hi
  CROSS JOIN LATERAL (
    SELECT profile_id, score FROM gr WHERE gr.game_id = w.game_id
    ORDER BY score, published_at, profile_id LIMIT 1
  ) lo;
$$;

-- Group's Hot Take: the reviewed game where the group's average is furthest
-- from everyone's (the community needs 3+ reviews). Games at least two members
-- reviewed win over one-member games, so in a big group one person's outlier
-- isn't passed off as the group's take.
CREATE OR REPLACE FUNCTION group_hot_take(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, group_count int, group_avg float8, community_count int, community_avg float8)
LANGUAGE sql STABLE AS $$
  WITH g AS (
    SELECT game_id, count(*)::int AS n, avg(score)::float8 AS a
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
    GROUP BY game_id
  )
  SELECT g.game_id, g.n, g.a, c.n, c.a
  FROM g
  -- LATERAL keeps each community aggregate on the reviews.game_id index
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n, avg(score)::float8 AS a
    FROM reviews r
    WHERE r.game_id = g.game_id AND r.status = 'published'
  ) c
  WHERE c.n >= 3
    AND round(g.a::numeric, 1) <> round(c.a::numeric, 1)
  ORDER BY (g.n >= 2) DESC, abs(g.a - c.a) DESC, g.game_id
  LIMIT 1;
$$;

-- Server-only, like the other stat functions: the pages call these with the
-- service-role client. Postgres grants EXECUTE to PUBLIC by default, and
-- Supabase's default privileges grant it to anon and authenticated.
REVOKE EXECUTE ON FUNCTION
  group_reviews(uuid, uuid, uuid),
  group_review_summary(uuid, uuid, uuid),
  group_member_review_stats(uuid, uuid, uuid),
  group_game_review_stats(uuid, uuid, uuid),
  group_game_member_scores(uuid, uuid[]),
  group_split_decision(uuid, uuid, uuid),
  group_hot_take(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_reviews(uuid, uuid, uuid),
  group_review_summary(uuid, uuid, uuid),
  group_member_review_stats(uuid, uuid, uuid),
  group_game_review_stats(uuid, uuid, uuid),
  group_game_member_scores(uuid, uuid[]),
  group_split_decision(uuid, uuid, uuid),
  group_hot_take(uuid, uuid, uuid)
TO service_role;
