-- Poll-answer comments pick up upvote/downvote parity with review comments.
-- The existing group_poll_answer_votes table only recorded "this user upvoted
-- this answer" (no direction column). Add a vote direction so a comment can
-- be upvoted OR downvoted; existing rows become upvotes.

ALTER TABLE group_poll_answer_votes
  ADD COLUMN IF NOT EXISTS vote smallint NOT NULL DEFAULT 1;

ALTER TABLE group_poll_answer_votes DROP CONSTRAINT IF EXISTS group_poll_answer_votes_vote_check;
ALTER TABLE group_poll_answer_votes ADD CONSTRAINT group_poll_answer_votes_vote_check
  CHECK (vote IN (-1, 1));
