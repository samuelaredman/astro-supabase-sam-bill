-- ─────────────────────────────────────────────────────────────────────────────
--  Group announcements (pinned posts) + polls
-- ─────────────────────────────────────────────────────────────────────────────

-- Announcements ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_announcements_group ON group_announcements(group_id);

ALTER TABLE group_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_announcements_select" ON group_announcements FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_announcements.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_announcements_insert" ON group_announcements FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_announcements_update" ON group_announcements FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_announcements.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_announcements_delete" ON group_announcements FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_announcements.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

-- Polls ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_polls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  closed      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_polls_group ON group_polls(group_id);

CREATE TABLE IF NOT EXISTS group_poll_options (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   UUID NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_group_poll_options_poll ON group_poll_options(poll_id);

CREATE TABLE IF NOT EXISTS group_poll_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
  option_id   UUID NOT NULL REFERENCES group_poll_options(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_group_poll_votes_poll ON group_poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_group_poll_votes_option ON group_poll_votes(option_id);

ALTER TABLE group_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_polls_select" ON group_polls FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_polls.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_polls_insert" ON group_polls FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_polls_update" ON group_polls FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_polls.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_polls_delete" ON group_polls FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_polls.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_poll_options_select" ON group_poll_options FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_polls
    JOIN group_members ON group_members.group_id = group_polls.group_id
    WHERE group_polls.id = group_poll_options.poll_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_poll_options_insert" ON group_poll_options FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_polls
    JOIN group_members ON group_members.group_id = group_polls.group_id
    WHERE group_polls.id = poll_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

-- Members can see every vote in a poll they can see (needed to tally results);
-- each member may only insert/delete their own vote.
CREATE POLICY "group_poll_votes_select" ON group_poll_votes FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_polls
    JOIN group_members ON group_members.group_id = group_polls.group_id
    WHERE group_polls.id = group_poll_votes.poll_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_poll_votes_insert" ON group_poll_votes FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM group_polls
    JOIN group_members ON group_members.group_id = group_polls.group_id
    WHERE group_polls.id = poll_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_poll_votes_delete" ON group_poll_votes FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
