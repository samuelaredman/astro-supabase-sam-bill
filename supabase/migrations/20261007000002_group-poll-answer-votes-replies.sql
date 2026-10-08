-- Upvotes and replies on the written answers to a featured game's question
-- (group_poll_answers, migration 20261006000008). The Games tab ranks answers
-- by upvotes and shows the top three, with replies under each.

CREATE TABLE IF NOT EXISTS group_poll_answer_votes (
  answer_id   uuid        NOT NULL REFERENCES group_poll_answers(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id, profile_id)
);

CREATE TABLE IF NOT EXISTS group_poll_answer_replies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id   uuid        NOT NULL REFERENCES group_poll_answers(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_poll_answer_replies_answer
  ON group_poll_answer_replies (answer_id, created_at);

-- Read and written only by the server (service role), like the answers.
ALTER TABLE group_poll_answer_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_poll_answer_replies ENABLE ROW LEVEL SECURITY;
