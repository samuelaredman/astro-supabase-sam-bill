-- ─────────────────────────────────────────────────────────────────────────────
--  List social: votes, reactions, comments + notifications column
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. list_votes
CREATE TABLE IF NOT EXISTS list_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES lists(id)    ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote       SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  UNIQUE(profile_id, list_id)
);
CREATE INDEX IF NOT EXISTS list_votes_list_id_idx ON list_votes (list_id);

ALTER TABLE list_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_votes_select" ON list_votes FOR SELECT USING (true);
CREATE POLICY "list_votes_insert" ON list_votes FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_votes_update" ON list_votes FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_votes_delete" ON list_votes FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 2. list_reactions
CREATE TABLE IF NOT EXISTS list_reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       UUID NOT NULL REFERENCES lists(id)    ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  UNIQUE(list_id, profile_id, reaction_type)
);
CREATE INDEX IF NOT EXISTS list_reactions_list_id_idx ON list_reactions (list_id);

ALTER TABLE list_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_reactions_select" ON list_reactions FOR SELECT USING (true);
CREATE POLICY "list_reactions_insert" ON list_reactions FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_reactions_delete" ON list_reactions FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 3. list_comments
CREATE TABLE IF NOT EXISTS list_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES lists(id)    ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS list_comments_list_id_idx ON list_comments (list_id);

ALTER TABLE list_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "list_comments_select" ON list_comments FOR SELECT USING (true);
CREATE POLICY "list_comments_insert" ON list_comments FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "list_comments_delete" ON list_comments FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 4. Add list_id to notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES lists(id) ON DELETE SET NULL;
