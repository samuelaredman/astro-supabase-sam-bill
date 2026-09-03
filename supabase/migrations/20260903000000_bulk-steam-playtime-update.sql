-- Replaces the one-at-a-time playtime update loop in steam/import.ts with a
-- single SQL UPDATE that joins against a JSONB array of {game_id, playtime} pairs.
CREATE OR REPLACE FUNCTION bulk_update_steam_playtime(
  p_profile_id uuid,
  p_updates     jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE user_game_status
  SET steam_playtime_minutes = (elem->>'playtime')::int
  FROM jsonb_array_elements(p_updates) AS elem
  WHERE profile_id = p_profile_id
    AND game_id    = (elem->>'game_id')::uuid;
$$;
