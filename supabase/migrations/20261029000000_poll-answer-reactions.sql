-- Emote reactions on group poll answers AND their replies, mirroring
-- comment_reactions on review comments. One row holds a reference to either
-- a top-level answer OR a reply (never both) so a single UNIQUE constraint
-- can cover (target, profile, reaction) across both kinds.
--
-- Two FK columns + a CHECK (one nullable each) keeps real cascades: deleting
-- a group_poll_answers row drops its reactions through answer_id's ON DELETE
-- CASCADE, same for replies.
CREATE TABLE IF NOT EXISTS group_poll_answer_reactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id     uuid        REFERENCES group_poll_answers(id)        ON DELETE CASCADE,
  reply_id      uuid        REFERENCES group_poll_answer_replies(id) ON DELETE CASCADE,
  profile_id    uuid        NOT NULL REFERENCES profiles(id)         ON DELETE CASCADE,
  reaction_type text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_poll_answer_reactions_one_target
    CHECK ((answer_id IS NULL) <> (reply_id IS NULL)),
  CONSTRAINT group_poll_answer_reactions_answer_unique
    UNIQUE (answer_id, profile_id, reaction_type),
  CONSTRAINT group_poll_answer_reactions_reply_unique
    UNIQUE (reply_id, profile_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS group_poll_answer_reactions_answer_id_idx
  ON group_poll_answer_reactions(answer_id) WHERE answer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_poll_answer_reactions_reply_id_idx
  ON group_poll_answer_reactions(reply_id) WHERE reply_id IS NOT NULL;

ALTER TABLE group_poll_answer_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_poll_answer_reactions_public_read"
  ON group_poll_answer_reactions FOR SELECT USING (true);

CREATE POLICY "group_poll_answer_reactions_write"
  ON group_poll_answer_reactions FOR ALL USING (true) WITH CHECK (true);
