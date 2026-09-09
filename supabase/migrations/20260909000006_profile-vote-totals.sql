-- The profile "upvotes / downvotes received" stat used five queries that each
-- pulled every individual vote row on everything the reviewer had posted
-- (review comments, lists, list comments, recommendations, recommendation
-- comments) purely so JS could count +1s and -1s. For an active account that is
-- thousands of rows across the wire to produce two numbers.
--
-- Counting in Postgres returns exactly two integers. Votes on the reviewer's own
-- *reviews* stay out of this: the page already has them from the review payload
-- it renders, so re-counting them here would be a second read for nothing.

CREATE OR REPLACE FUNCTION profile_vote_totals(p_profile_id uuid)
RETURNS TABLE(upvotes int, downvotes int) LANGUAGE sql STABLE AS $$
WITH v AS (
SELECT cv.vote
  FROM comment_votes cv
  JOIN review_comments rc ON rc.id = cv.comment_id
  WHERE rc.profile_id = p_profile_id
UNION ALL
SELECT lv.vote
  FROM list_votes lv
  JOIN lists l ON l.id = lv.list_id
  WHERE l.profile_id = p_profile_id
UNION ALL
SELECT lcv.vote
  FROM list_comment_votes lcv
  JOIN list_comments lc ON lc.id = lcv.comment_id
  WHERE lc.profile_id = p_profile_id
UNION ALL
SELECT rv.vote
  FROM recommendation_votes rv
  JOIN recommendations r ON r.id = rv.recommendation_id
  WHERE r.profile_id = p_profile_id
UNION ALL
SELECT rcv.vote
  FROM recommendation_comment_votes rcv
  JOIN recommendation_comments rc2 ON rc2.id = rcv.comment_id
  WHERE rc2.profile_id = p_profile_id
)
SELECT
count(*) FILTER (WHERE vote = 1)::int,
count(*) FILTER (WHERE vote = -1)::int
FROM v;
$$;
