-- Bump poll comment body limit from 500 → 2000 characters to match
-- review_comments (which has no explicit limit, but the client caps at 2000).
-- Keeps the lower bound at 1 to still reject empty bodies.
ALTER TABLE group_poll_answers
  DROP CONSTRAINT IF EXISTS group_poll_answers_body_check;
ALTER TABLE group_poll_answers
  ADD CONSTRAINT group_poll_answers_body_check
  CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000);
