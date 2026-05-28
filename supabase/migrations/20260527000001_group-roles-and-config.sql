-- Add custom roles, stats config, and join prompt to groups system

-- 1. group_roles table
CREATE TABLE IF NOT EXISTS group_roles (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text NOT NULL DEFAULT '#6050c8',
  can_invite              bool NOT NULL DEFAULT false,
  can_remove_members      bool NOT NULL DEFAULT false,
  can_edit_group          bool NOT NULL DEFAULT false,
  can_manage_sessions     bool NOT NULL DEFAULT false,
  can_manage_watchlist    bool NOT NULL DEFAULT false,
  is_view_only            bool NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Custom role FK on group_members
ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES group_roles(id) ON DELETE SET NULL;

-- 3. stats_config and join_prompt on groups
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS stats_config jsonb,
  ADD COLUMN IF NOT EXISTS join_prompt  text;

-- 4. RLS for group_roles
ALTER TABLE group_roles ENABLE ROW LEVEL SECURITY;

-- Members can read roles for their groups
DROP POLICY IF EXISTS "group_roles_select_member" ON group_roles;
CREATE POLICY "group_roles_select_member" ON group_roles
  FOR SELECT USING (is_group_member(group_id));

-- Only owner / admin can insert/update/delete roles
DROP POLICY IF EXISTS "group_roles_insert_admin" ON group_roles;
CREATE POLICY "group_roles_insert_admin" ON group_roles
  FOR INSERT WITH CHECK (is_group_admin_or_owner(group_id));

DROP POLICY IF EXISTS "group_roles_update_admin" ON group_roles;
CREATE POLICY "group_roles_update_admin" ON group_roles
  FOR UPDATE USING (is_group_admin_or_owner(group_id));

DROP POLICY IF EXISTS "group_roles_delete_admin" ON group_roles;
CREATE POLICY "group_roles_delete_admin" ON group_roles
  FOR DELETE USING (is_group_admin_or_owner(group_id));
