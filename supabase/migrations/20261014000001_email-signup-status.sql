-- email_signup_status(email) — tells /api/auth/signup whether an account
-- already exists for this email, and if so whether it has confirmed yet. The
-- route uses it to reject a re-signup to a pending-confirmation address with
-- a clear message, instead of silently calling supabase.auth.signUp again
-- (which re-sends the confirmation but keeps the first attempt's username,
-- so a user who meant to change their name lands with the old one and no
-- error signal anywhere — see CLAUDE.md Rule 5 / signup-flow audit).
--
-- SECURITY DEFINER because `auth.users` lives in the auth schema. EXECUTE
-- restricted to service_role so only server-side admin-client calls can hit
-- it — this is a probe-sensitive query (email enumeration), so it must never
-- be reachable from anon/authenticated callers.
--
-- Returns 'confirmed' | 'unconfirmed' | NULL (no row).

CREATE OR REPLACE FUNCTION email_signup_status(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
    WHEN email_confirmed_at IS NOT NULL THEN 'confirmed'
    ELSE 'unconfirmed'
  END
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION email_signup_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION email_signup_status(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION email_signup_status(text) TO service_role;
