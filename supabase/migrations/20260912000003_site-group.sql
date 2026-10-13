-- The site group: one group ("Chekpoint") that every profile is in, so the
-- group stats — the Stats tab, "vs the community", the feed — work site-wide.
--
-- Marked by groups.is_site_group rather than a hard-coded id, so the app and
-- these triggers find it the same way. At most one group can carry the flag.
--
-- The group row itself, and the backfill of existing profiles, are data, not
-- schema: they are run by hand in the SQL editor (see the PR). Until the row
-- exists the trigger below does nothing.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_site_group boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS groups_one_site_group ON groups ((true)) WHERE is_site_group;

-- Every new profile joins the site group. handle_new_user inserts the profile
-- during signup, so this runs inside signup's transaction: it must never raise,
-- or a problem with the group would stop people creating accounts.
CREATE OR REPLACE FUNCTION join_site_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO group_members (group_id, profile_id, role)
    SELECT g.id, NEW.id, 'member'
    FROM groups g
    WHERE g.is_site_group
    ON CONFLICT (group_id, profile_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'join_site_group: could not add profile % to the site group: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_join_site_group ON profiles;
CREATE TRIGGER on_profile_join_site_group
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION join_site_group();

-- Nobody leaves the site group and nobody is removed from it. The API routes
-- refuse first with a friendly message; this is the backstop for anything that
-- deletes rows directly. A membership still goes when its profile (account
-- deletion) or its group is deleted: by the time the cascade reaches
-- group_members the parent row is no longer visible.
CREATE OR REPLACE FUNCTION keep_site_group_members()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM groups g WHERE g.id = OLD.group_id AND g.is_site_group)
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = OLD.profile_id) THEN
    RAISE EXCEPTION 'Members cannot leave or be removed from the site group'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS keep_site_group_members ON group_members;
CREATE TRIGGER keep_site_group_members
  BEFORE DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION keep_site_group_members();

-- The site group can't be deleted either, which would take every membership
-- with it. Clear the flag first if it ever genuinely has to go.
CREATE OR REPLACE FUNCTION keep_site_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_site_group THEN
    RAISE EXCEPTION 'The site group cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS keep_site_group ON groups;
CREATE TRIGGER keep_site_group
  BEFORE DELETE ON groups
  FOR EACH ROW EXECUTE FUNCTION keep_site_group();
