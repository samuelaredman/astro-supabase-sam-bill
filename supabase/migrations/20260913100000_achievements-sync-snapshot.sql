-- Cache the owned-games list per achievement-sync session on the profile row
-- so the sync doesn't re-hit Steam's GetOwnedGames on every 40-game batch.
-- The snapshot holds the FILTERED list of games this sync needs to process
-- (delta already applied), plus started_at for expiry. Cleared when the sync
-- completes.
--
-- Also expose the set of appids a profile has any user_achievements rows for
-- as an RPC, so the delta filter can skip games we already have data on
-- without paginating through thousands of achievement rows in JS.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS achievements_sync_snapshot jsonb;

CREATE OR REPLACE FUNCTION user_synced_steam_appids(p_profile_id uuid)
RETURNS TABLE(steam_appid int)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ua.steam_appid
  FROM user_achievements ua
  WHERE ua.profile_id = p_profile_id
    AND ua.steam_appid IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION user_synced_steam_appids(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION user_synced_steam_appids(uuid)
TO service_role;
