-- Bulk-update RPCs for the PSN sync, mirroring Steam's
-- bulk_update_steam_playtime pattern. Needed to stay inside Netlify's 10s
-- function budget for large libraries (user with 4,000 PSN titles timed out
-- at ~284 writes because the application-side update loops were doing one
-- round-trip per row).

-- 1) Seed games.psn_np_communication_id in bulk for games matched this sync.
--    Guard `AND g.psn_np_communication_id IS NULL` prevents clobbering a
--    mapping someone else wrote concurrently (unique partial index enforces
--    one npCommId per game anyway). Input: jsonb array of
--    { game_id, np_comm_id }.
CREATE OR REPLACE FUNCTION bulk_set_games_psn_mapping(
  p_updates jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE games g
  SET psn_np_communication_id = (elem->>'np_comm_id')::text
  FROM jsonb_array_elements(p_updates) AS elem
  WHERE g.id = (elem->>'game_id')::uuid
    AND g.psn_np_communication_id IS NULL;
$$;

-- 2) Refresh PSN metadata on existing user_game_status rows in bulk.
--    Writes only PSN-specific columns and is_owned — mirrors the per-row
--    update that was there before, but in one SQL statement. Does NOT touch
--    `status`, so manual statuses (playing/completed/dropped) stay intact.
--    Input: jsonb array where each element has game_id + the PSN fields.
--    COALESCE pattern mirrors bulk_update_steam_playtime so nulls in the
--    payload don't nuke existing values.
CREATE OR REPLACE FUNCTION bulk_update_psn_library(
  p_profile_id uuid,
  p_updates     jsonb
) RETURNS void LANGUAGE sql AS $$
  UPDATE user_game_status
  SET psn_np_communication_id = COALESCE((elem->>'psn_np_communication_id')::text, psn_np_communication_id),
      psn_platform             = COALESCE((elem->>'psn_platform')::text, psn_platform),
      psn_trophies_earned      = COALESCE((elem->>'psn_trophies_earned')::int, psn_trophies_earned),
      psn_trophies_total       = COALESCE((elem->>'psn_trophies_total')::int, psn_trophies_total),
      psn_platinum_earned      = COALESCE((elem->>'psn_platinum_earned')::boolean, psn_platinum_earned),
      psn_progress             = COALESCE((elem->>'psn_progress')::int, psn_progress),
      psn_playtime_minutes     = COALESCE((elem->>'psn_playtime_minutes')::int, psn_playtime_minutes),
      psn_last_played_at       = COALESCE((elem->>'psn_last_played_at')::timestamptz, psn_last_played_at),
      psn_display_game_id      = COALESCE((elem->>'psn_display_game_id')::uuid, psn_display_game_id),
      is_owned                 = true
  FROM jsonb_array_elements($2) AS elem
  WHERE profile_id = $1
    AND game_id    = (elem->>'game_id')::uuid;
$$;
