-- Feed/detail pages embed each review's votes, comments, and comment votes and
-- resolve them with `... WHERE review_id IN (...)` / `WHERE comment_id IN (...)`.
-- The only indexes on these tables are the composite UNIQUE keys, and they lead
-- with profile_id, so a lookup keyed on review_id / comment_id alone falls back
-- to a sequential scan. That cost grows with every vote and comment and shows up
-- as slow homepage reloads and a laggy up/down-vote round trip.
--
-- review_reactions already has a UNIQUE(review_id, profile_id, reaction_type)
-- index that covers review_id-leading lookups, so it needs nothing here.

CREATE INDEX IF NOT EXISTS review_votes_review_id_idx
  ON review_votes(review_id);

CREATE INDEX IF NOT EXISTS review_comments_review_id_idx
  ON review_comments(review_id);

CREATE INDEX IF NOT EXISTS comment_votes_comment_id_idx
  ON comment_votes(comment_id);

-- follows' UNIQUE(follower_id, following_id) can't serve a follower-count lookup
-- keyed on following_id alone.
CREATE INDEX IF NOT EXISTS follows_following_id_idx
  ON follows(following_id);

-- forum_post_votes' only index is UNIQUE(profile_id, post_id); the vote
-- endpoint and post page tally votes keyed on post_id alone.
-- (list_votes and recommendation_votes already have a *_id index.)
CREATE INDEX IF NOT EXISTS forum_post_votes_post_id_idx
  ON forum_post_votes(post_id);
