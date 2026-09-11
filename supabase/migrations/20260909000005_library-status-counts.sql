-- The profile page's Library filter pills needed nine separate
-- `count: 'exact', head: true` requests against user_game_status — nine round
-- trips and nine scans of the same rows, on every profile view.
--
-- One pass with FILTER clauses returns all nine numbers in a single row. The
-- caller still zeroes want_to_play / dropped / hidden per its privacy rules.

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
    )::int
  FROM user_game_status
  WHERE profile_id = p_profile_id;
$$;
