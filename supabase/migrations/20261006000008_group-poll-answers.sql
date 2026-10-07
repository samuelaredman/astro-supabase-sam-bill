-- Written answers to a featured game's question on the group Games tab.
-- The question is a group_polls row (featured_game_id set); its options are
-- optional, and members can always answer in their own words too. One answer
-- per member per question, which they can edit or delete.

CREATE TABLE IF NOT EXISTS group_poll_answers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     uuid        NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_group_poll_answers_poll
  ON group_poll_answers (poll_id, created_at DESC);

-- Read and written only by the server (service role), like group_featured_games.
ALTER TABLE group_poll_answers ENABLE ROW LEVEL SECURITY;
