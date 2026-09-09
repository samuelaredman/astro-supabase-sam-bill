-- When steam/import.ts finds a game the user already tracks (e.g. it was added
-- to their library automatically when they reviewed it, before they ever synced
-- Steam), it only bulk-updated steam_playtime_minutes and never wrote
-- steam_appid. So the row stayed steam_appid = NULL: the library never showed it
-- as Steam-linked and the achievement sync (which maps appid -> game_id via
-- user_game_status.steam_appid) stored its achievements unlinked (game_id NULL).
--
-- Now also set steam_appid (and is_owned) from the payload. COALESCE keeps the
-- existing appid when a payload row omits it, so this is safe for any caller
-- that still sends {game_id, playtime} only.

CREATE OR REPLACE FUNCTION bulk_update_steam_playtime(
  p_profile_id uuid,
  p_updates     jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE user_game_status
  SET steam_playtime_minutes = (elem->>'playtime')::int,
      steam_appid            = COALESCE((elem->>'appid')::int, steam_appid),
      is_owned              = true
  FROM jsonb_array_elements($2) AS elem
  WHERE profile_id = $1
    AND game_id    = (elem->>'game_id')::uuid;
$$;
