-- Per-game trophy completion for a profile: one row per PSN title with a
-- synced trophy set, `pct` in 0..1. Powers the Library "Completion %" sort's
-- PSN branch, parallel to achievement_completion_by_appid for Steam.
-- Bounded by the profile's synced-title count (hundreds at most) and index-
-- assisted by user_trophies_profile_idx.

CREATE OR REPLACE FUNCTION trophy_completion_by_npcommid(p_profile_id uuid)
RETURNS TABLE(np_communication_id text, pct real) LANGUAGE sql STABLE AS $$
  SELECT np_communication_id,
         (count(*) FILTER (WHERE earned))::real / NULLIF(count(*), 0)::real AS pct
  FROM user_trophies
  WHERE profile_id = p_profile_id
  GROUP BY np_communication_id;
$$;
