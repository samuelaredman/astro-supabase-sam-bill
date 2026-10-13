-- The Stats tab's "tale of the tape": a side-by-side profile of the subject
-- and the other side (one member, or the community — every other member,
-- pooled), from their reviews in the group.
--
-- Unlike group_versus_summary this doesn't need shared games: it describes
-- each side's own reviews, so it has something to say even when the two have
-- never reviewed the same game.
--
-- Reads through group_reviews() like the other group_* functions. The hot-take
-- rate compares a review with the rest of the site's average for that game,
-- from game_review_stats (the review-stats rule in CLAUDE.md), with the review
-- itself taken back out of the average.

CREATE OR REPLACE FUNCTION group_versus_profile(
  p_group_id uuid,
  p_profile_id uuid,
  p_other_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  side text,
  review_count int,
  top_genre text, top_genre_count int,
  top_platform text, top_platform_count int,
  top_studio text, top_studio_count int,
  avg_release_year float8,
  avg_hours float8, hours_sum int,
  tens int,
  hot_takes int, hot_take_base int,
  avg_words float8
)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT CASE WHEN gr.profile_id = p_profile_id THEN 'subject' ELSE 'other' END AS side,
           gr.game_id, gr.score, gr.body, gr.play_time_hours, gr.platform_played_on
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) gr
    WHERE p_other_id IS NULL OR gr.profile_id IN (p_profile_id, p_other_id)
  ), base AS (
    SELECT r.side,
           count(*)::int AS review_count,
           avg(extract(year FROM g.date_released)) FILTER (WHERE g.date_released IS NOT NULL)::float8 AS avg_release_year,
           avg(r.play_time_hours) FILTER (WHERE r.play_time_hours > 0)::float8 AS avg_hours,
           coalesce(sum(r.play_time_hours) FILTER (WHERE r.play_time_hours > 0), 0)::int AS hours_sum,
           count(*) FILTER (WHERE r.score = 10)::int AS tens,
           -- 3+ points from everyone else on the site who reviewed the game
           count(*) FILTER (
             WHERE s.review_count > 1
               AND abs(r.score - (s.score_sum - r.score)::float8 / (s.review_count - 1)) >= 3
           )::int AS hot_takes,
           count(*) FILTER (WHERE s.review_count > 1)::int AS hot_take_base,
           avg(array_length(regexp_split_to_array(btrim(r.body), '\s+'), 1))
             FILTER (WHERE btrim(coalesce(r.body, '')) <> '')::float8 AS avg_words
    FROM r
    JOIN games g ON g.id = r.game_id
    LEFT JOIN game_review_stats s ON s.game_id = r.game_id
    GROUP BY r.side
  ), genre AS (
    SELECT DISTINCT ON (r.side) r.side, gn.name, count(*)::int AS n
    FROM r
    JOIN game_genres gg ON gg.game_id = r.game_id
    JOIN genres gn ON gn.id = gg.genre_id
    GROUP BY r.side, gn.name
    ORDER BY r.side, count(*) DESC, gn.name
  ), plat AS (
    SELECT DISTINCT ON (r.side) r.side, p.name, count(*)::int AS n
    FROM r
    JOIN platforms p ON p.id = r.platform_played_on
    GROUP BY r.side, p.name
    ORDER BY r.side, count(*) DESC, p.name
  ), studio AS (
    SELECT DISTINCT ON (r.side) r.side, d.name, count(DISTINCT r.game_id)::int AS n
    FROM r
    JOIN game_companies gc ON gc.game_id = r.game_id AND gc.role = 'developer'
    JOIN developers d ON d.id = gc.company_id
    GROUP BY r.side, d.name
    ORDER BY r.side, count(DISTINCT r.game_id) DESC, d.name
  )
  SELECT sd.side,
         coalesce(b.review_count, 0),
         ge.name, ge.n,
         pl.name, pl.n,
         st.name, st.n,
         b.avg_release_year,
         b.avg_hours, coalesce(b.hours_sum, 0),
         coalesce(b.tens, 0),
         coalesce(b.hot_takes, 0), coalesce(b.hot_take_base, 0),
         b.avg_words
  FROM unnest(ARRAY['subject', 'other']) AS sd(side)
  LEFT JOIN base b ON b.side = sd.side
  LEFT JOIN genre ge ON ge.side = sd.side
  LEFT JOIN plat pl ON pl.side = sd.side
  LEFT JOIN studio st ON st.side = sd.side;
$$;

-- Server-only, like the rest of the review stats.
REVOKE EXECUTE ON FUNCTION group_versus_profile(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION group_versus_profile(uuid, uuid, uuid, uuid, uuid) TO service_role;
