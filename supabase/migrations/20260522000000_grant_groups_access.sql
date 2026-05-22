-- Grant table-level access to anon and authenticated roles so RLS policies
-- can actually filter rows. Without these grants the roles see no rows at all.

GRANT SELECT ON groups TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON groups TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON group_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_watchlist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_session_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_invites TO authenticated;
