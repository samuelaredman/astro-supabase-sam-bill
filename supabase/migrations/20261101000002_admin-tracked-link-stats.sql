-- admin_tracked_link_stats() — one row per tracked link for /admin/links:
-- clicks, signups through it, and how those signups have stuck around, using
-- the same definitions as admin_campaign_cohorts:
--   * returned_1d  — posted a review, comment or rec at least 1 day after signup
--   * matured      — signed up at least 14 days ago
--   * retained_14d — of the matured, posted at least 14 days after signup
--
-- SECURITY DEFINER because auth.users is in the auth schema. service_role only.

CREATE OR REPLACE FUNCTION admin_tracked_link_stats()
RETURNS TABLE (
  id                uuid,
  code              text,
  label             text,
  destination       text,
  campaign_id       uuid,
  campaign_name     text,
  owner_profile_id  uuid,
  owner_username    text,
  clicks            int,
  created_at        timestamptz,
  signups           int,
  returned_1d       int,
  matured           int,
  retained_14d      int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH signup AS (
    SELECT p.signup_link_id AS link_id, p.id AS profile_id, u.created_at AS signup_at
      FROM profiles p
      JOIN auth.users u ON u.id = p.auth_user_id
     WHERE p.signup_link_id IS NOT NULL
  ),
  scored AS (
    SELECT s.*, GREATEST(
      (SELECT max(r.created_at)   FROM reviews r           WHERE r.profile_id   = s.profile_id),
      (SELECT max(cm.created_at)  FROM review_comments cm  WHERE cm.profile_id  = s.profile_id),
      (SELECT max(rec.created_at) FROM recommendations rec WHERE rec.profile_id = s.profile_id)
    ) AS last_post_at
      FROM signup s
  ),
  per_link AS (
    SELECT link_id,
           count(*)::int AS signups,
           count(*) FILTER (WHERE last_post_at >= signup_at + interval '1 day')::int AS returned_1d,
           count(*) FILTER (WHERE signup_at <= now() - interval '14 days')::int AS matured,
           count(*) FILTER (
             WHERE signup_at <= now() - interval '14 days'
               AND last_post_at >= signup_at + interval '14 days'
           )::int AS retained_14d
      FROM scored
     GROUP BY link_id
  )
  SELECT l.id, l.code, l.label, l.destination,
         l.campaign_id, c.name, l.owner_profile_id, o.username,
         l.clicks, l.created_at,
         COALESCE(pl.signups, 0), COALESCE(pl.returned_1d, 0),
         COALESCE(pl.matured, 0), COALESCE(pl.retained_14d, 0)
    FROM tracked_links l
    LEFT JOIN marketing_campaigns c ON c.id = l.campaign_id
    LEFT JOIN profiles o ON o.id = l.owner_profile_id
    LEFT JOIN per_link pl ON pl.link_id = l.id
   ORDER BY l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION admin_tracked_link_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_tracked_link_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_tracked_link_stats() TO service_role;
