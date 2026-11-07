-- Votes and reactions for site-wide forum post comments (/updates).
-- Mirrors review comment_votes / comment_reactions.

CREATE TABLE IF NOT EXISTS forum_comment_votes (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id uuid     NOT NULL REFERENCES forum_comments(id) ON DELETE CASCADE,
  vote       smallint NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_fcv_comment ON forum_comment_votes(comment_id);

CREATE TABLE IF NOT EXISTS forum_comment_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    uuid NOT NULL REFERENCES forum_comments(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, profile_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_fcr_comment ON forum_comment_reactions(comment_id);

ALTER TABLE forum_comment_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcv_select" ON forum_comment_votes
  FOR SELECT USING (true);
CREATE POLICY "fcv_own"    ON forum_comment_votes
  FOR ALL USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());

CREATE POLICY "fcr_select" ON forum_comment_reactions
  FOR SELECT USING (true);
CREATE POLICY "fcr_own"    ON forum_comment_reactions
  FOR ALL USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());
