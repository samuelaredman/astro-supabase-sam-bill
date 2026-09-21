-- The original library_status_counts.unplayed filter only looked at
-- steam_playtime_minutes. PSN-imported games (and any game outside Steam's
-- reach) always fell into "unplayed" regardless of the trophies the user
-- had earned on them — Sony's API often returns null for playtime even on
-- heavily-played titles, so playtime alone can't stand in for "has been
-- played" on PSN.
--
-- Widen the check: a game is unplayed only when NO source has evidence of
-- play. Evidence per source:
--   Steam → steam_playtime_minutes > 0  (Steam always reports playtime)
--   PSN   → psn_playtime_minutes  > 0  OR  psn_trophies_earned > 0
--            (trophies are definitive proof of play; playtime is patchy)
--   Xbox  → xbox_current_gamerscore > 0
--            (gamerscore = unlocked-achievement points, always reported)
--
-- Mirrored in src/utils/libraryQuery.ts (list) and
-- src/pages/api/user-game-status/library.ts (idsOnly + letterMap).

CREATE OR REPLACE FUNCTION library_status_counts(p_profile_id uuid)
RETURNS TABLE(
  all_count        int,
  playing          int,
  want_to_play     int,
  owned            int,
  completed        int,
  hundred_percent  int,
  dropped          int,
  hidden           int,
  unplayed         int
) LANGUAGE sql STABLE AS $$
  SELECT
    count(*) FILTER (WHERE NOT is_hidden)::int,
    count(*) FILTER (WHERE NOT is_hidden AND status = 'playing')::int,
    count(*) FILTER (WHERE NOT is_hidden AND status = 'want_to_play')::int,
    count(*) FILTER (WHERE NOT is_hidden AND is_owned)::int,
    count(*) FILTER (WHERE NOT is_hidden AND status IN ('completed', 'hundred_percent'))::int,
    count(*) FILTER (WHERE NOT is_hidden AND status = 'hundred_percent')::int,
    count(*) FILTER (WHERE NOT is_hidden AND status = 'dropped')::int,
    count(*) FILTER (WHERE is_hidden)::int,
    count(*) FILTER (
      WHERE NOT is_hidden
        AND status NOT IN ('completed', 'hundred_percent')
        AND coalesce(steam_playtime_minutes, 0) = 0
        AND coalesce(psn_playtime_minutes, 0) = 0
        AND coalesce(psn_trophies_earned, 0) = 0
        AND coalesce(xbox_current_gamerscore, 0) = 0
    )::int
  FROM user_game_status
  WHERE profile_id = p_profile_id;
$$;
