-- Two reviewer-profile stats that aggregated review rows in JS.

-- "More reviews than N% of reviewers". The page paged through the author of
-- every published review on the site, on every profile view, to produce this
-- one number. Matches the JS: the share of other reviewers (anyone with at
-- least one published review, minus this one) who have fewer published
-- reviews; NULL when there is nobody to compare against.
CREATE OR REPLACE FUNCTION reviewer_volume_percentile(p_profile_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH counts AS (
    SELECT profile_id, count(*) AS n
    FROM reviews
    WHERE status = 'published'
    GROUP BY profile_id
  ),
  me AS (
    SELECT coalesce((SELECT n FROM counts WHERE profile_id = p_profile_id), 0) AS n
  )
  SELECT CASE WHEN count(*) > 1
              THEN round(count(*) FILTER (WHERE counts.n < me.n) * 100.0 / (count(*) - 1))::int
         END
  FROM counts CROSS JOIN me
  GROUP BY me.n;
$$;

-- Community score and play-time aggregates for each game this reviewer has
-- published a review of (their own review included) — the "vs. community"
-- delta and the chart averages. Replaces fetching every community review of
-- those games, and the `.in()` of every reviewed game id that came with it.
CREATE OR REPLACE FUNCTION profile_game_community_stats(p_profile_id uuid)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8, hours_count int, hours_sum int)
LANGUAGE sql STABLE AS $$
  SELECT s.game_id, s.review_count, s.avg_score, s.hours_count, s.hours_sum
  FROM game_review_stats s
  WHERE s.game_id IN (
    SELECT r.game_id FROM reviews r
    WHERE r.profile_id = p_profile_id AND r.status = 'published'
  );
$$;
