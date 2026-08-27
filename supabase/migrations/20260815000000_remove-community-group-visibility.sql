-- ─────────────────────────────────────────────────────────────────────────────
--  Remove 'community' group visibility tier
--  Auto-joining every new signup to every community group doesn't scale —
--  groups are public or private only again.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Convert any existing community groups to public before tightening the constraint
UPDATE groups SET visibility = 'public' WHERE visibility = 'community';

-- 2. Drop the auto-join-on-signup trigger and function
DROP TRIGGER IF EXISTS on_profile_created_join_communities ON profiles;
DROP FUNCTION IF EXISTS auto_join_community_groups();

-- 3. Restore the two-value CHECK constraint
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_visibility_check;
ALTER TABLE groups ADD CONSTRAINT groups_visibility_check
  CHECK (visibility IN ('public', 'private'));

-- 4. Restore groups_select to public/private only
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  visibility = 'public'
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = groups.id
      AND group_members.profile_id = (
        SELECT id FROM profiles WHERE auth_user_id = auth.uid()
      )
  )
);

-- 5. Restore group_members_insert self-join to public only
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
    AND EXISTS (SELECT 1 FROM groups WHERE id = group_id AND visibility = 'public')
  )
);
