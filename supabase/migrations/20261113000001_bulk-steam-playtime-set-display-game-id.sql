-- Extend the Steam re-sync update RPC to also write display_game_id so already-
-- tracked rows pick up the primary edition on subsequent syncs (new rows use
-- the direct INSERT path which already writes it). COALESCE keeps the existing
-- value when the payload omits it.

CREATE OR REPLACE FUNCTION bulk_update_steam_playtime(
  p_profile_id uuid,
  p_updates     jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE user_game_status
  SET steam_playtime_minutes = (elem->>'playtime')::int,
      steam_appid            = COALESCE((elem->>'appid')::int, steam_appid),
      steam_last_played_at   = COALESCE((elem->>'last_played')::timestamptz, steam_last_played_at),
      display_game_id        = COALESCE((elem->>'display_game_id')::uuid, display_game_id),
      is_owned              = true
  FROM jsonb_array_elements($2) AS elem
  WHERE profile_id = $1
    AND game_id    = (elem->>'game_id')::uuid;
$$;
