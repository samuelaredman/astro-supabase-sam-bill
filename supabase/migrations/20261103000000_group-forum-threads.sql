-- ─────────────────────────────────────────────────────────────────────────────
--  Member-created forum threads: like announcements, but any current member
--  may start one by default. Owner/mods can lock the feature down via
--  groups.forums_everyone.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS forums_everyone BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS group_forum_threads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT,
  body       TEXT NOT NULL,
  pinned     BOOLEAN NOT NULL DEFAULT false,
  is_locked  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gft_group   ON group_forum_threads(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gft_profile ON group_forum_threads(profile_id);

CREATE TABLE IF NOT EXISTS group_forum_thread_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES group_forum_threads(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id  UUID REFERENCES group_forum_thread_comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gftc_thread ON group_forum_thread_comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_gftc_parent ON group_forum_thread_comments(parent_id);

ALTER TABLE group_forum_threads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_forum_thread_comments ENABLE ROW LEVEL SECURITY;

-- Public groups: anyone can read threads. Private groups: members only.
CREATE POLICY "gft_select" ON group_forum_threads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = group_forum_threads.group_id
      AND (
        g.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = g.id
            AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
        )
      )
  )
);

-- Comments follow the thread's group visibility.
CREATE POLICY "gftc_select" ON group_forum_thread_comments FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM group_forum_threads t
    JOIN groups g ON g.id = t.group_id
    WHERE t.id = group_forum_thread_comments.thread_id
      AND (
        g.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = g.id
            AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
        )
      )
  )
);

-- Insert/update/delete are API-driven (service role), so RLS write policies
-- are intentionally restrictive and only there for defence in depth.
CREATE POLICY "gftc_insert" ON group_forum_thread_comments FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1
    FROM group_forum_threads t
    JOIN group_members gm ON gm.group_id = t.group_id
    WHERE t.id = thread_id
      AND t.is_locked = false
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "gftc_delete" ON group_forum_thread_comments FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1
    FROM group_forum_threads t
    JOIN group_members gm ON gm.group_id = t.group_id
    WHERE t.id = group_forum_thread_comments.thread_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND gm.role IN ('owner', 'admin')
  )
);
