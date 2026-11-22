-- Site-wide Discussions: a forum under /discussions that mirrors the
-- per-group Forums > Discussions sub-tab. Any signed-in user can start a
-- thread; site admins can pin/lock/delete anything; comments reuse the
-- shared CommentThread with the same votes/reactions/edit shape as other
-- comment surfaces.

CREATE TABLE IF NOT EXISTS site_discussions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      text,
  body       text NOT NULL,
  pinned     boolean NOT NULL DEFAULT false,
  is_locked  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_site_discussions_created ON site_discussions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_discussions_profile ON site_discussions(profile_id);
-- Primary listing order: pinned first, newest within pinned.
CREATE INDEX IF NOT EXISTS idx_site_discussions_listing ON site_discussions(pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS site_discussion_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL REFERENCES site_discussions(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES site_discussion_comments(id) ON DELETE CASCADE,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sdc_discussion ON site_discussion_comments(discussion_id);
CREATE INDEX IF NOT EXISTS idx_sdc_parent     ON site_discussion_comments(parent_id);

CREATE TABLE IF NOT EXISTS site_discussion_comment_votes (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id uuid     NOT NULL REFERENCES site_discussion_comments(id) ON DELETE CASCADE,
  vote       smallint NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_sdcv_comment ON site_discussion_comment_votes(comment_id);

CREATE TABLE IF NOT EXISTS site_discussion_comment_reactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    uuid NOT NULL REFERENCES site_discussion_comments(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, profile_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_sdcr_comment ON site_discussion_comment_reactions(comment_id);

ALTER TABLE site_discussions                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_discussion_comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_discussion_comment_votes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_discussion_comment_reactions   ENABLE ROW LEVEL SECURITY;

-- Discussions: anyone can read; author writes; API gates admin actions.
CREATE POLICY "site_discussions_select" ON site_discussions FOR SELECT USING (true);
CREATE POLICY "site_discussions_insert" ON site_discussions FOR INSERT
  WITH CHECK (profile_id = get_my_profile_id());
CREATE POLICY "site_discussions_update_own" ON site_discussions FOR UPDATE
  USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());
CREATE POLICY "site_discussions_delete_own" ON site_discussions FOR DELETE
  USING (profile_id = get_my_profile_id());

-- Comments: anyone can read; author writes own.
CREATE POLICY "sdc_select" ON site_discussion_comments FOR SELECT USING (true);
CREATE POLICY "sdc_insert" ON site_discussion_comments FOR INSERT
  WITH CHECK (profile_id = get_my_profile_id());
CREATE POLICY "sdc_update_own" ON site_discussion_comments FOR UPDATE
  USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());
CREATE POLICY "sdc_delete_own" ON site_discussion_comments FOR DELETE
  USING (profile_id = get_my_profile_id());

-- Votes / reactions: public read, user manages own. Same pattern as
-- forum_post_votes / review comment_votes.
CREATE POLICY "sdcv_select" ON site_discussion_comment_votes FOR SELECT USING (true);
CREATE POLICY "sdcv_own"    ON site_discussion_comment_votes FOR ALL
  USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());

CREATE POLICY "sdcr_select" ON site_discussion_comment_reactions FOR SELECT USING (true);
CREATE POLICY "sdcr_own"    ON site_discussion_comment_reactions FOR ALL
  USING (profile_id = get_my_profile_id())
  WITH CHECK (profile_id = get_my_profile_id());
