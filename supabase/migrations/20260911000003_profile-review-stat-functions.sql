-- Two reviewer-profile stats that aggregated review rows in JS.

-- Published review count per reviewer — the per-profile counterpart of
-- game_review_stats, with the same contract: callers read through it, so it
-- can become a trigger-maintained table later without them changing.
CREATE OR REPLACE VIEW profile_review_stats WITH (security_invoker = true) AS
SELECT profile_id, count(*)::int AS review_count
FROM reviews
WHERE status = 'published'
GROUP BY profile_id;

-- "More reviews than N% of reviewers". The page paged through the author of
-- every published review on the site, on every profile view, to produce this
-- one number. Matches the JS: the share of other reviewers (anyone with at
-- least one published review, minus this one) who have fewer published
-- reviews; NULL when there is nobody to compare against.
CREATE OR REPLACE FUNCTION reviewer_volume_percentile(p_profile_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH me AS (
    SELECT coalesce(
      (SELECT review_count FROM profile_review_stats WHERE profile_id = p_profile_id), 0
    ) AS n
  )
  SELECT CASE WHEN count(*) > 1
              THEN round(count(*) FILTER (WHERE s.review_count < me.n) * 100.0 / (count(*) - 1))::int
         END
  FROM profile_review_stats s CROSS JOIN me
  GROUP BY me.n;
$$;

-- Community score and play-time aggregates for each game this reviewer has
-- published a review of (their own review included) — the "vs. community"
-- delta and the chart averages. Replaces fetching every community review of
-- those games, and the `.in()` of every reviewed game id that came with it.
CREATE OR REPLACE FUNCTION profile_game_community_stats(p_profile_id uuid)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8, hours_count int, hours_sum int)
LANGUAGE sql STABLE AS $$
  -- LATERAL, not `WHERE game_id IN (subquery)`: the IN form stops Postgres
  -- pushing the filter into the view, so it aggregated every review on the site
  -- first. Per-game equality reaches the index on reviews.game_id — cost tracks
  -- this reviewer's games, not the size of the site.
  SELECT s.game_id, s.review_count, s.avg_score, s.hours_count, s.hours_sum
  FROM (
    SELECT DISTINCT r.game_id FROM reviews r
    WHERE r.profile_id = p_profile_id AND r.status = 'published'
  ) mine
  CROSS JOIN LATERAL (
    SELECT * FROM game_review_stats v WHERE v.game_id = mine.game_id
  ) s;
$$;
