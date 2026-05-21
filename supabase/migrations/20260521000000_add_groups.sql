-- ─────────────────────────────────────────────
--  Groups feature
-- ─────────────────────────────────────────────

-- Groups
CREATE TABLE groups (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  description  TEXT,
  avatar_url   TEXT,
  visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  invite_code  TEXT UNIQUE,
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membership
CREATE TABLE group_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, profile_id)
);

-- Group want-to-play list
CREATE TABLE group_watchlist (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes      TEXT,
  UNIQUE (group_id, game_id)
);

-- Game night sessions
CREATE TABLE group_sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  played_at  DATE NOT NULL,
  notes      TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL
);

-- Who attended each session
CREATE TABLE group_session_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (session_id, profile_id)
);

-- Direct user-to-user invites (for private groups)
CREATE TABLE group_invites (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id           UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invited_by         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ,
  UNIQUE (group_id, invited_profile_id)
);

-- ─────────────────────────────────────────────
--  Add group_id to notifications
-- ─────────────────────────────────────────────

ALTER TABLE notifications
  ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────
--  Enforce max 10 groups created per user
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_group_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM groups WHERE created_by = NEW.created_by) >= 10 THEN
    RAISE EXCEPTION 'You cannot create more than 10 groups';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER enforce_group_limit
  BEFORE INSERT ON groups
  FOR EACH ROW EXECUTE FUNCTION check_group_limit();

-- ─────────────────────────────────────────────
--  Indexes
-- ─────────────────────────────────────────────

CREATE INDEX idx_group_members_profile   ON group_members(profile_id);
CREATE INDEX idx_group_members_group     ON group_members(group_id);
CREATE INDEX idx_group_watchlist_group   ON group_watchlist(group_id);
CREATE INDEX idx_group_sessions_group    ON group_sessions(group_id);
CREATE INDEX idx_group_invites_invited   ON group_invites(invited_profile_id);
CREATE INDEX idx_notifications_group     ON notifications(group_id) WHERE group_id IS NOT NULL;

-- ─────────────────────────────────────────────
--  Row Level Security
-- ─────────────────────────────────────────────

ALTER TABLE groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_watchlist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_session_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_invites        ENABLE ROW LEVEL SECURITY;

-- groups: public groups visible to all; private groups visible to members only
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

CREATE POLICY "groups_insert" ON groups FOR INSERT WITH CHECK (
  created_by = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "groups_update" ON groups FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = groups.id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "groups_delete" ON groups FOR DELETE USING (
  created_by = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- group_members: members can see other members; only owners/admins can add/remove
CREATE POLICY "group_members_select" ON group_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_members_insert" ON group_members FOR INSERT WITH CHECK (
  -- owners/admins can add anyone; users can add themselves to public groups
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

CREATE POLICY "group_members_delete" ON group_members FOR DELETE USING (
  -- owners/admins can remove anyone; members can remove themselves
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND gm.role IN ('owner', 'admin')
  )
);

-- group_watchlist: members only
CREATE POLICY "group_watchlist_select" ON group_watchlist FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_watchlist.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_watchlist_insert" ON group_watchlist FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_watchlist_delete" ON group_watchlist FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_watchlist.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

-- group_sessions: members only
CREATE POLICY "group_sessions_select" ON group_sessions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_sessions.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_sessions_insert" ON group_sessions FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_sessions_delete" ON group_sessions FOR DELETE USING (
  created_by = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_sessions.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

-- group_session_members: visible to group members
CREATE POLICY "group_session_members_select" ON group_session_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM group_sessions gs
    JOIN group_members gm ON gm.group_id = gs.group_id
    WHERE gs.id = group_session_members.session_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_session_members_insert" ON group_session_members FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_sessions gs
    JOIN group_members gm ON gm.group_id = gs.group_id
    WHERE gs.id = session_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "group_session_members_delete" ON group_session_members FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_sessions gs
    JOIN group_members gm ON gm.group_id = gs.group_id
    WHERE gs.id = group_session_members.session_id
      AND gm.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND gm.role IN ('owner', 'admin')
  )
);

-- group_invites: only the invited user or group admins/owners can see
CREATE POLICY "group_invites_select" ON group_invites FOR SELECT USING (
  invited_profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_invites.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_invites_insert" ON group_invites FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);

CREATE POLICY "group_invites_update" ON group_invites FOR UPDATE USING (
  -- only the invited user can accept/decline
  invited_profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "group_invites_delete" ON group_invites FOR DELETE USING (
  invited_by = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM group_members
    WHERE group_members.group_id = group_invites.group_id
      AND group_members.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      AND group_members.role IN ('owner', 'admin')
  )
);
