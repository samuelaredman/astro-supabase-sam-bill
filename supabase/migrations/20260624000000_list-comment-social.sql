-- ─────────────────────────────────────────────────────────────────────────────
--  List comment social: threading, votes, reactions
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add parent_id (threading) + updated_at to list_comments
ALTER TABLE list_comments
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES list_comments(id) ON DELETE CASCADE;

ALTER TABLE list_comments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS list_comments_parent_id_idx ON list_comments (parent_id);

-- 2. list_comment_votes
CREATE TABLE IF NOT EXISTS list_comment_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES list_comments(id) ON DELETE CASCADE,
  vote       SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, comment_id)
);

CREATE INDEX IF NOT EXISTS list_comment_votes_comment_id_idx ON list_comment_votes (comment_id);

ALTER TABLE list_comment_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_comment_votes_select" ON list_comment_votes FOR SELECT USING (true);
CREATE POLICY "list_comment_votes_insert" ON list_comment_votes FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_comment_votes_update" ON list_comment_votes FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_comment_votes_delete" ON list_comment_votes FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 3. list_comment_reactions
CREATE TABLE IF NOT EXISTS list_comment_reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    UUID NOT NULL REFERENCES list_comments(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (comment_id, profile_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS list_comment_reactions_comment_id_idx ON list_comment_reactions (comment_id);

ALTER TABLE list_comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_comment_reactions_select" ON list_comment_reactions FOR SELECT USING (true);
CREATE POLICY "list_comment_reactions_insert" ON list_comment_reactions FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_comment_reactions_delete" ON list_comment_reactions FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
