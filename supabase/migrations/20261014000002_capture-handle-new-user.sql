-- Capture handle_new_user() and its trigger.
--
-- This function has existed on prod since before migrations were used in this
-- repo. It was referenced throughout the code (CLAUDE.md calls it out as the
-- source of profile rows on signup) but never committed, so any edit in the
-- Supabase dashboard would have left no record. This migration captures the
-- live definition verbatim so a fresh DB rebuild lands the same trigger, and
-- so future edits are reviewable in git.
--
-- Definition pulled from the live DB via:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--
-- CREATE OR REPLACE is idempotent for the function; DROP + CREATE for the
-- trigger (CREATE TRIGGER IF NOT EXISTS isn't portable).
--
-- Observed concerns (not fixed here — one concern per migration):
--   * No `SET search_path` on this SECURITY DEFINER function. The function
--     only touches qualified names (public.profiles, NEW.*, split_part) so
--     a hijacked search_path can't currently redirect it, but adding
--     `SET search_path = public, pg_temp` would be defense in depth.
--   * Email-prefix fallback (split_part(NEW.email, '@', 1)) can produce
--     usernames that don't match the nameRules.FORMAT regex (dots, hyphens,
--     plus signs) and can collide with existing usernames — in which case
--     the INSERT fails and signUp surfaces "database error saving new user"
--     with no further detail. The signup.ts username pre-check only covers
--     the raw_user_meta_data path. Signup.ts always sends `username` so
--     this fallback is only reached by non-standard paths (admin invite,
--     direct Supabase dashboard creates).

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _username TEXT;
BEGIN
  _username := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (
    auth_user_id,
    username,
    is_active,
    is_group_admin,
    want_to_play_privacy,
    dropped_privacy,
    banner_position,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    _username,
    TRUE,
    FALSE,
    'public',
    'public',
    'center',
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
