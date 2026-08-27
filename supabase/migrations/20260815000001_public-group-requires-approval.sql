-- ─────────────────────────────────────────────────────────────────────────────
--  Public groups: optional "requires approval to join" setting
--  Public groups remain discoverable/viewable by anyone, but owners/admins can
--  require applications instead of allowing instant self-join.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE groups ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false;

-- Self-join via group_members_insert is only allowed for public groups that
-- do NOT require approval; approval-gated joins go through group_join_requests
-- (reviewed by an owner/admin, who then inserts the member row via the admin client).
DROP POLICY IF EXISTS "group_members_insert" ON group_members;
CREATE POLICY "group_members_insert" ON group_members FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = group_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND gm.role IN ('owner', 'admin')
  )
  OR (
    profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM groups
      WHERE id = group_id AND visibility = 'public' AND requires_approval = false
    )
  )
);
