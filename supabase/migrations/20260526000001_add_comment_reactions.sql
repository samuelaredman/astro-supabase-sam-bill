CREATE TABLE IF NOT EXISTS comment_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id   uuid        NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  reaction_type text       NOT NULL,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT comment_reactions_unique UNIQUE (comment_id, profile_id, reaction_type)
);

ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comment_reactions_public_read" ON comment_reactions
  FOR SELECT USING (true);

CREATE POLICY "comment_reactions_write" ON comment_reactions
  FOR ALL USING (true) WITH CHECK (true);
