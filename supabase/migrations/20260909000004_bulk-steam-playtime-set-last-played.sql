-- Extend the already-tracked update path (steam/import.ts) to also write
-- steam_last_played_at from the payload. COALESCE keeps the existing value when
-- a payload row omits last_played or the game was never played (rtime = 0), so
-- a known last-played date is never lost.

CREATE OR REPLACE FUNCTION bulk_update_steam_playtime(
  p_profile_id uuid,
  p_updates     jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE user_game_status
  SET steam_playtime_minutes = (elem->>'playtime')::int,
      steam_appid            = COALESCE((elem->>'appid')::int, steam_appid),
      steam_last_played_at   = COALESCE((elem->>'last_played')::timestamptz, steam_last_played_at),
      is_owned              = true
  FROM jsonb_array_elements($2) AS elem
  WHERE profile_id = $1
    AND game_id    = (elem->>'game_id')::uuid;
$$;
