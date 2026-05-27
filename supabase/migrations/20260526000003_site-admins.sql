-- Site admins table
-- Grants Sam and Bill moderation/admin access across the site.
-- Completely separate from is_group_admin (community group creation) on profiles.
--
-- Security model:
--   - No RLS policies defined = user client is blocked entirely
--   - Only the service role (admin client) can read or write this table
--   - Membership is managed manually via the Supabase SQL editor only
--   - No application route should ever INSERT or DELETE from this table

CREATE TABLE IF NOT EXISTS site_admins (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE site_admins ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies added — all user-client access is denied by default
