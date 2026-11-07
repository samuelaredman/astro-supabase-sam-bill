-- Votes and reactions for group forum thread comments (the "Discussions"
-- sub-tab under Forums). Mirrors review comment_votes / comment_reactions.

CREATE TABLE IF NOT EXISTS group_forum_thread_comment_votes (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id uuid     NOT NULL REFERENCES group_forum_thread_comments(id) ON DELETE CASCADE,
  vote       smallint NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_gftcv_comment ON group_forum_thread_comment_votes(comment_id);

CREATE TABLE IF NOT EXISTS group_forum_thread_comment_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    uuid NOT NULL REFERENCES group_forum_thread_comments(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, profile_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_gftcr_comment ON group_forum_thread_comment_reactions(comment_id);

ALTER TABLE group_forum_thread_comment_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_forum_thread_comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gftcv_select" ON group_forum_thread_comment_votes
  FOR SELECT USING (true);
CREATE POLICY "gftcv_own"    ON group_forum_thread_comment_votes
  FOR ALL USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());

CREATE POLICY "gftcr_select" ON group_forum_thread_comment_reactions
  FOR SELECT USING (true);
CREATE POLICY "gftcr_own"    ON group_forum_thread_comment_reactions
  FOR ALL USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());
