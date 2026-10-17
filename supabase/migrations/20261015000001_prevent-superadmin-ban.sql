-- Defense-in-depth protection: founder accounts (bill, sam) can never have
-- banned_until set to a future value. Mirrors the UNBANNABLE_PROFILE_IDS
-- allowlist in src/pages/api/admin/users/ban.ts, but at the auth.users level,
-- so even direct SQL from service_role (or a compromised future admin going
-- around the API) can't ban them without consciously disabling this trigger.
--
-- The guard fires on BEFORE UPDATE whenever banned_until actually changes.
-- Setting banned_until to NULL (unban) is still allowed — belt-and-suspenders
-- in case Supabase ever temporarily bans someone we need to reset.

CREATE OR REPLACE FUNCTION public.prevent_superadmin_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.id IN (
    '39d62a9b-7d93-45e2-aa8e-22710a6d0949'::uuid,  -- bill
    '1ddf7809-3db4-4434-8741-539ecdafcc3f'::uuid   -- sam
  ) AND NEW.banned_until IS NOT NULL AND NEW.banned_until > now() THEN
    RAISE EXCEPTION 'Cannot ban superadmin account (auth_user_id=%)', NEW.id
      USING HINT = 'Protected by prevent_superadmin_ban trigger.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_superadmin_ban_tg ON auth.users;
CREATE TRIGGER prevent_superadmin_ban_tg
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  WHEN (NEW.banned_until IS DISTINCT FROM OLD.banned_until)
  EXECUTE FUNCTION public.prevent_superadmin_ban();
