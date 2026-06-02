-- ─────────────────────────────────────────────────────────────────────────────
--  Group visibility: add 'community' tier + admin flag + join requests
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Expand visibility CHECK to include 'community'
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_visibility_check;
ALTER TABLE groups ADD CONSTRAINT groups_visibility_check
  CHECK (visibility IN ('public', 'private', 'community'));

-- 2. Admin flag on profiles (Sam + Bill only — flipped manually in Supabase)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_group_admin BOOLEAN NOT NULL DEFAULT false;

-- 3. Join requests table (user-initiated, for private groups)
CREATE TABLE IF NOT EXISTS group_join_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  UNIQUE (group_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_group_join_requests_group
  ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_profile
  ON group_join_requests(profile_id);

-- 4. RLS on join requests
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;

-- Requester sees their own; group admins/owners see all for their group
CREATE POLICY "join_requests_select" ON group_join_requests FOR SELECT USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_join_requests.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

-- Anyone authenticated can submit a request
CREATE POLICY "join_requests_insert" ON group_join_requests FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- Only admins/owners can update (accept/reject)
CREATE POLICY "join_requests_update" ON group_join_requests FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_join_requests.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

-- Requester can delete their own pending request
CREATE POLICY "join_requests_delete" ON group_join_requests FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 5. Update groups_select to include community groups (public-like visibility)
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  visibility IN ('public', 'community')
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = groups.id
      AND group_members.profile_id = (
        SELECT id FROM profiles WHERE auth_user_id = auth.uid()
      )
  )
);

-- 6. Update group_members_insert to allow self-join on community groups too
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
    AND EXISTS (SELECT 1 FROM groups WHERE id = group_id AND visibility IN ('public', 'community'))
  )
);

-- 7. Exempt admins from the 10-group creation limit
CREATE OR REPLACE FUNCTION check_group_limit()
RETURNS TRIGGER AS $$
BEGIN
  -- Admins (Sam / Bill) can create unlimited groups
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.created_by AND is_group_admin = true) THEN
    RETURN NEW;
  END IF;
  IF (SELECT COUNT(*) FROM groups WHERE created_by = NEW.created_by) >= 10 THEN
    RAISE EXCEPTION 'You cannot create more than 10 groups';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Auto-join community groups for every new profile
CREATE OR REPLACE FUNCTION auto_join_community_groups()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO group_members (group_id, profile_id, role)
  SELECT id, NEW.id, 'member'
  FROM groups
  WHERE visibility = 'community'
  ON CONFLICT (group_id, profile_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created_join_communities ON profiles;
CREATE TRIGGER on_profile_created_join_communities
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_join_community_groups();
