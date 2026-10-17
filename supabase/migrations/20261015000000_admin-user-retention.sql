-- admin_user_retention(window_days) — 14-day signup retention cohorts.
--
-- For every user who signed up at least 14 days ago (so the window has closed)
-- and at most `window_days` ago, returns one row per signup-week with:
--   * cohort_size   — users who signed up that week
--   * retained_14d  — users who posted ANY review/comment/recommendation at
--                     least 14 days after their own signup
--   * retained_pct  — retained_14d / cohort_size, as %
--
-- "Posted" uses created_at on each content table — we don't track visit sessions,
-- so content is the only objective "came back and used the site" signal.
--
-- SECURITY DEFINER because auth.users is in the auth schema. Execution is
-- restricted to service_role for the same reason as admin_daily_activity.

CREATE OR REPLACE FUNCTION admin_user_retention(window_days int DEFAULT 90)
RETURNS TABLE (
  cohort_week   date,
  cohort_size   int,
  retained_14d  int,
  retained_pct  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH cohort AS (
    SELECT
      p.id AS profile_id,
      u.created_at AS signup_at,
      date_trunc('week', u.created_at)::date AS cohort_week
    FROM auth.users u
    JOIN profiles p ON p.auth_user_id = u.id
    WHERE u.created_at <= now() - interval '14 days'
      AND u.created_at >= now() - make_interval(days => window_days)
  ),
  retention AS (
    SELECT
      c.cohort_week,
      (
        EXISTS (
          SELECT 1 FROM reviews r
           WHERE r.profile_id = c.profile_id
             AND r.created_at >= c.signup_at + interval '14 days'
        )
        OR EXISTS (
          SELECT 1 FROM review_comments cm
           WHERE cm.profile_id = c.profile_id
             AND cm.created_at >= c.signup_at + interval '14 days'
        )
        OR EXISTS (
          SELECT 1 FROM recommendations rec
           WHERE rec.profile_id = c.profile_id
             AND rec.created_at >= c.signup_at + interval '14 days'
        )
      ) AS retained
    FROM cohort c
  )
  SELECT
    cohort_week,
    COUNT(*)::int                            AS cohort_size,
    COUNT(*) FILTER (WHERE retained)::int    AS retained_14d,
    CASE WHEN COUNT(*) = 0 THEN 0::numeric
      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE retained) / COUNT(*), 1)
    END                                      AS retained_pct
  FROM retention
  GROUP BY cohort_week
  ORDER BY cohort_week DESC;
$$;

REVOKE ALL ON FUNCTION admin_user_retention(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_retention(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_user_retention(int) TO service_role;
