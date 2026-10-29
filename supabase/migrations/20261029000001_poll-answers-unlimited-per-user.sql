-- Drop the one-answer-per-user constraint on group_poll_answers so comments
-- on a poll work exactly like comments on a review — any member can post as
-- many as they want, each with its own votes / reactions / replies.
--
-- Voting on the poll's OPTIONS stays one-per-user (group_poll_votes).
ALTER TABLE group_poll_answers
  DROP CONSTRAINT IF EXISTS group_poll_answers_poll_id_profile_id_key;
