-- Cache the "no achievements available" verdict for Steam apps so the
-- achievement sync stops re-polling them every session.
--
-- Steam's GetPlayerAchievements returns HTTP 400 with
-- {"playerstats":{"success":false,"error":"Requested app has no stats"}}
-- for apps that have no achievement API support (freebies, demos, older
-- games). The sync previously couldn't distinguish this from a transient
-- Steam-side failure — every session re-queried the same games and, when
-- a session's delta happened to consist only of these, surfaced a
-- misleading "Steam didn't return achievement data this time" error to
-- the user.
--
-- Two-part fix:
--   1) A no_achievements flag on steam_app_schema, set by the sync loop
--      when it detects the 400/success:false shape.
--   2) The freshness RPC unions in these appids using fetched_at as the
--      "last synced" moment, so the delta filter's
--      rtime_last_played > last_synced_at comparison naturally re-checks
--      the verdict only if the user launches the game again after we
--      last checked (in case the developer added achievements post-launch).

ALTER TABLE steam_app_schema
  ADD COLUMN IF NOT EXISTS no_achievements bool NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION steam_appid_last_synced(p_profile_id uuid)
RETURNS TABLE(steam_appid int, last_synced_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT steam_appid, max(ts) AS last_synced_at
  FROM (
    SELECT ua.steam_appid, max(ua.synced_at) AS ts
    FROM user_achievements ua
    WHERE ua.profile_id = p_profile_id
      AND ua.steam_appid IS NOT NULL
    GROUP BY ua.steam_appid

    UNION ALL

    SELECT s.steam_appid, s.fetched_at AS ts
    FROM steam_app_schema s
    WHERE s.no_achievements = true
  ) x
  GROUP BY steam_appid;
$$;

REVOKE EXECUTE ON FUNCTION steam_appid_last_synced(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION steam_appid_last_synced(uuid)
TO service_role;
