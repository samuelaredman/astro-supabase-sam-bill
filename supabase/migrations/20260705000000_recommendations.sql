-- ─────────────────────────────────────────────────────────────────────────────
--  Recommendations: a user-generated post type — "if you liked Game A, try Game B"
--  + a written body. Mirrors the Lists social model (votes / reactions / comments,
--  threaded comment votes + reactions, and a notifications FK column).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_game_id   UUID NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  target_game_id   UUID NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  body             TEXT NOT NULL,
  contains_spoilers BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recommendations_distinct_games CHECK (source_game_id <> target_game_id),
  UNIQUE (profile_id, source_game_id, target_game_id)
);
CREATE INDEX IF NOT EXISTS recommendations_source_game_idx ON recommendations (source_game_id);
CREATE INDEX IF NOT EXISTS recommendations_target_game_idx ON recommendations (target_game_id);
CREATE INDEX IF NOT EXISTS recommendations_profile_idx     ON recommendations (profile_id);
CREATE INDEX IF NOT EXISTS recommendations_created_at_idx  ON recommendations (created_at DESC);

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendations_select" ON recommendations FOR SELECT USING (true);
CREATE POLICY "recommendations_insert" ON recommendations FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendations_update" ON recommendations FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendations_delete" ON recommendations FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 2. recommendation_votes
CREATE TABLE IF NOT EXISTS recommendation_votes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  vote              SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  UNIQUE (profile_id, recommendation_id)
);
CREATE INDEX IF NOT EXISTS recommendation_votes_rec_id_idx ON recommendation_votes (recommendation_id);

ALTER TABLE recommendation_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendation_votes_select" ON recommendation_votes FOR SELECT USING (true);
CREATE POLICY "recommendation_votes_insert" ON recommendation_votes FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_votes_update" ON recommendation_votes FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_votes_delete" ON recommendation_votes FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 3. recommendation_reactions
CREATE TABLE IF NOT EXISTS recommendation_reactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  reaction_type     TEXT NOT NULL,
  UNIQUE (recommendation_id, profile_id, reaction_type)
);
CREATE INDEX IF NOT EXISTS recommendation_reactions_rec_id_idx ON recommendation_reactions (recommendation_id);

ALTER TABLE recommendation_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendation_reactions_select" ON recommendation_reactions FOR SELECT USING (true);
CREATE POLICY "recommendation_reactions_insert" ON recommendation_reactions FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_reactions_delete" ON recommendation_reactions FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 4. recommendation_comments (threaded)
CREATE TABLE IF NOT EXISTS recommendation_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES profiles(id)        ON DELETE CASCADE,
  body              TEXT NOT NULL,
  parent_id         UUID REFERENCES recommendation_comments(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recommendation_comments_rec_id_idx    ON recommendation_comments (recommendation_id);
CREATE INDEX IF NOT EXISTS recommendation_comments_parent_id_idx ON recommendation_comments (parent_id);

ALTER TABLE recommendation_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendation_comments_select" ON recommendation_comments FOR SELECT USING (true);
CREATE POLICY "recommendation_comments_insert" ON recommendation_comments FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_comments_delete" ON recommendation_comments FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 5. recommendation_comment_votes
CREATE TABLE IF NOT EXISTS recommendation_comment_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id)                ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES recommendation_comments(id) ON DELETE CASCADE,
  vote       SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, comment_id)
);
CREATE INDEX IF NOT EXISTS recommendation_comment_votes_comment_id_idx ON recommendation_comment_votes (comment_id);

ALTER TABLE recommendation_comment_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendation_comment_votes_select" ON recommendation_comment_votes FOR SELECT USING (true);
CREATE POLICY "recommendation_comment_votes_insert" ON recommendation_comment_votes FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_comment_votes_update" ON recommendation_comment_votes FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_comment_votes_delete" ON recommendation_comment_votes FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 6. recommendation_comment_reactions
CREATE TABLE IF NOT EXISTS recommendation_comment_reactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    UUID NOT NULL REFERENCES recommendation_comments(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id)                ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (comment_id, profile_id, reaction_type)
);
CREATE INDEX IF NOT EXISTS recommendation_comment_reactions_comment_id_idx ON recommendation_comment_reactions (comment_id);

ALTER TABLE recommendation_comment_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recommendation_comment_reactions_select" ON recommendation_comment_reactions FOR SELECT USING (true);
CREATE POLICY "recommendation_comment_reactions_insert" ON recommendation_comment_reactions FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
CREATE POLICY "recommendation_comment_reactions_delete" ON recommendation_comment_reactions FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 7. Add recommendation_id to notifications
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recommendation_id UUID REFERENCES recommendations(id) ON DELETE SET NULL;
