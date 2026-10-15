-- admin_daily_activity(days) — per-day counts for the admin activity dashboard.
--
-- Returns one row per day over the trailing `days` window ending today, with
-- counts for signups (auth.users), published reviews, comments, recommendations
-- and reports. The dashboard uses the signup series to make auth-flow outages
-- visible at a glance — two separate signup-breaking regressions shipped
-- undetected before this view existed (see the auth-emails rules in CLAUDE.md).
--
-- SECURITY DEFINER because `auth.users` is in the auth schema; the function
-- runs as its owner (postgres) rather than the caller. Execution is restricted
-- to service_role so only server-side admin routes can call it.

CREATE OR REPLACE FUNCTION admin_daily_activity(days int DEFAULT 30)
RETURNS TABLE (
  day              date,
  signups          bigint,
  reviews          bigint,
  comments         bigint,
  recommendations  bigint,
  reports          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH span AS (
    SELECT generate_series(
      (now() - make_interval(days => days))::date,
      now()::date,
      '1 day'
    )::date AS day
  ),
  events AS (
    SELECT created_at::date AS day, 'signup'::text AS kind
      FROM auth.users
     WHERE created_at >= (now() - make_interval(days => days))
    UNION ALL
    SELECT published_at::date, 'review'
      FROM reviews
     WHERE status = 'published' AND published_at >= (now() - make_interval(days => days))
    UNION ALL
    SELECT created_at::date, 'comment'
      FROM review_comments
     WHERE created_at >= (now() - make_interval(days => days))
    UNION ALL
    SELECT created_at::date, 'recommendation'
      FROM recommendations
     WHERE created_at >= (now() - make_interval(days => days))
    UNION ALL
    SELECT created_at::date, 'report'
      FROM reports
     WHERE created_at >= (now() - make_interval(days => days))
  )
  SELECT
    s.day,
    count(*) FILTER (WHERE e.kind = 'signup')          AS signups,
    count(*) FILTER (WHERE e.kind = 'review')          AS reviews,
    count(*) FILTER (WHERE e.kind = 'comment')         AS comments,
    count(*) FILTER (WHERE e.kind = 'recommendation')  AS recommendations,
    count(*) FILTER (WHERE e.kind = 'report')          AS reports
  FROM span s
  LEFT JOIN events e ON e.day = s.day
  GROUP BY s.day
  ORDER BY s.day;
$$;

REVOKE ALL ON FUNCTION admin_daily_activity(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_daily_activity(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_daily_activity(int) TO service_role;
