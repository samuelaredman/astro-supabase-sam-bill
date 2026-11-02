-- admin_campaign_cohorts(organic_days) — retention of users who signed up during
-- each marketing campaign, plus an "organic" baseline row (campaign_id NULL) for
-- signups in the last `organic_days` days that fall outside every campaign.
--
-- Per row:
--   * signups      — users whose signup day (UTC) falls inside the campaign window
--   * returned_1d  — of those, users who posted a review, comment or rec at least
--                    1 day after signing up. An early signal, readable straight away.
--   * matured      — users who signed up at least 14 days ago
--   * retained_14d — of the matured users, those who posted at least 14 days after
--                    signing up (same definition as admin_user_retention)
--
-- Posting during signup day itself never counts, so a giveaway that requires a
-- review to enter doesn't inflate either number. A user inside two overlapping
-- campaigns counts in both.
--
-- SECURITY DEFINER because auth.users is in the auth schema. Execution is
-- restricted to service_role, like admin_daily_activity.

CREATE OR REPLACE FUNCTION admin_campaign_cohorts(organic_days int DEFAULT 90)
RETURNS TABLE (
  campaign_id   uuid,
  name          text,
  kind          text,
  starts_on     date,
  ends_on       date,
  signups       int,
  returned_1d   int,
  matured       int,
  retained_14d  int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH signup AS (
    SELECT p.id AS profile_id, u.created_at AS signup_at, u.created_at::date AS signup_day
      FROM auth.users u
      JOIN profiles p ON p.auth_user_id = u.id
  ),
  cohort AS (
    SELECT c.id AS campaign_id, c.name, c.kind, c.starts_on, c.ends_on, s.profile_id, s.signup_at
      FROM marketing_campaigns c
      LEFT JOIN signup s
        ON s.signup_day BETWEEN c.starts_on AND COALESCE(c.ends_on, current_date)
    UNION ALL
    SELECT NULL::uuid, 'Organic (no campaign)', 'organic',
           current_date - organic_days, NULL::date, s.profile_id, s.signup_at
      FROM signup s
     WHERE s.signup_day >= current_date - organic_days
       AND NOT EXISTS (
         SELECT 1 FROM marketing_campaigns c
          WHERE s.signup_day BETWEEN c.starts_on AND COALESCE(c.ends_on, current_date)
       )
  ),
  scored AS (
    SELECT co.*, lp.last_post_at
      FROM cohort co
      LEFT JOIN LATERAL (
        SELECT GREATEST(
          (SELECT max(r.created_at)   FROM reviews r          WHERE r.profile_id   = co.profile_id),
          (SELECT max(cm.created_at)  FROM review_comments cm WHERE cm.profile_id  = co.profile_id),
          (SELECT max(rec.created_at) FROM recommendations rec WHERE rec.profile_id = co.profile_id)
        ) AS last_post_at
      ) lp ON co.profile_id IS NOT NULL
  )
  SELECT
    campaign_id, name, kind, starts_on, ends_on,
    count(profile_id)::int AS signups,
    count(*) FILTER (WHERE last_post_at >= signup_at + interval '1 day')::int AS returned_1d,
    count(*) FILTER (WHERE signup_at <= now() - interval '14 days')::int AS matured,
    count(*) FILTER (
      WHERE signup_at <= now() - interval '14 days'
        AND last_post_at >= signup_at + interval '14 days'
    )::int AS retained_14d
  FROM scored
  GROUP BY campaign_id, name, kind, starts_on, ends_on
  ORDER BY (campaign_id IS NULL), starts_on DESC;
$$;

REVOKE ALL ON FUNCTION admin_campaign_cohorts(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_campaign_cohorts(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_campaign_cohorts(int) TO service_role;
