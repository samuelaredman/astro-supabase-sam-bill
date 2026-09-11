CREATE TABLE IF NOT EXISTS forum_post_votes (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id    uuid     NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  vote       smallint NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz DEFAULT now(),
  UNIQUE (profile_id, post_id)
);

CREATE TABLE IF NOT EXISTS forum_post_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (post_id, profile_id, reaction_type)
);

ALTER TABLE forum_post_votes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read post votes"     ON forum_post_votes    FOR SELECT USING (true);
CREATE POLICY "Users manage own post votes" ON forum_post_votes    FOR ALL    USING (profile_id = get_my_profile_id()) WITH CHECK (profile_id = get_my_profile_id());

CREATE POLICY "Public read post reactions"      ON forum_post_reactions FOR SELECT USING (true);
CREATE POLICY "Users manage own post reactions" ON forum_post_reactions FOR ALL    USING (profile_id = get_my_profile_id()) WITH CHECK (profile_id = get_my_profile_id());
