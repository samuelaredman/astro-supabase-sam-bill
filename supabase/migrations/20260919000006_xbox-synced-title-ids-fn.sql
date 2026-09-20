-- Returns the set of xbox_title_ids for which the caller's profile has at
-- least one row in user_xbox_achievements. Used by /api/xbox/sync-achievements
-- as one half of the "safe to skip" delta: a title can be skipped on resync
-- iff we've synced it before (this function) AND its gamerscore in
-- user_game_status matches what titleHistory currently reports.
--
-- Distinct dedupe runs inside Postgres against the (profile_id) index —
-- much cheaper than pulling every achievement row over the wire and
-- deduping client-side, which for a heavy user is thousands of rows.
CREATE OR REPLACE FUNCTION xbox_synced_title_ids(p_profile_id uuid)
RETURNS TABLE(xbox_title_id text)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT xbox_title_id
  FROM user_xbox_achievements
  WHERE profile_id = p_profile_id
$$;
