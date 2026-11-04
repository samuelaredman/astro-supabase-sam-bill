-- ─────────────────────────────────────────────────────────────────────────────
--  Make group announcements first-class threads: optional title, lockable
--  comment threads, and a dedicated comments table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE group_announcements
  ADD COLUMN IF NOT EXISTS title      TEXT,
  ADD COLUMN IF NOT EXISTS is_locked  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS group_announcement_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES group_announcements(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES group_announcement_comments(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gac_announcement ON group_announcement_comments(announcement_id);
CREATE INDEX IF NOT EXISTS idx_gac_parent       ON group_announcement_comments(parent_id);

ALTER TABLE group_announcement_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gac_select" ON group_announcement_comments FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM group_announcements a
    JOIN group_members gm ON gm.group_id = a.group_id
    WHERE a.id = group_announcement_comments.announcement_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "gac_insert" ON group_announcement_comments FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1
    FROM group_announcements a
    JOIN group_members gm ON gm.group_id = a.group_id
    WHERE a.id = announcement_id
      AND a.is_locked = false
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "gac_delete" ON group_announcement_comments FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1
    FROM group_announcements a
    JOIN group_members gm ON gm.group_id = a.group_id
    WHERE a.id = group_announcement_comments.announcement_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND gm.role IN ('owner', 'admin')
  )
);
