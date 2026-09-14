-- Refine the achievement sync delta to compare Steam's rtime_last_played
-- against per-game freshness (max synced_at from user_achievements) instead
-- of the profile-wide achievements_synced_at.
--
-- The profile-wide marker is wrong for two failure modes:
--   1. A prior sync silently skipped a game (Steam returned null, cursor
--      advanced past it, marker moved forward anyway). The game's actual
--      last-polled time is old, but the profile marker looks fresh, so the
--      next delta sync skips it forever.
--   2. Delayed unlocks (offline plays, cloud propagation) can land in
--      Steam after we synced, and the game's rtime_last_played may not be
--      newer than a recent full-sync marker.
--
-- Per-game freshness fixes both: the delta compares Steam's per-game launch
-- time against our per-game last-polled time.

CREATE OR REPLACE FUNCTION steam_appid_last_synced(p_profile_id uuid)
RETURNS TABLE(steam_appid int, last_synced_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT ua.steam_appid, max(ua.synced_at)
  FROM user_achievements ua
  WHERE ua.profile_id = p_profile_id
    AND ua.steam_appid IS NOT NULL
  GROUP BY ua.steam_appid;
$$;

REVOKE EXECUTE ON FUNCTION steam_appid_last_synced(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION steam_appid_last_synced(uuid)
TO service_role;
