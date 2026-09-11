-- The review-stats view and functions are called only from server code with the
-- service-role client (CLAUDE.md: admin client for all DB reads). Take them off
-- the public API so anon / authenticated keys can't call them directly: each
-- aggregates over every published review, which is cheap per page render but
-- not something the open REST endpoint should let anyone run in a loop.
--
-- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase's default
-- privileges grant it (and SELECT on new views) to anon and authenticated.

REVOKE SELECT ON game_review_stats, profile_review_stats FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON game_review_stats, profile_review_stats TO service_role;

REVOKE EXECUTE ON FUNCTION
  ranked_games(int, int, int),
  review_score_summary(),
  most_reviewed_games(int, uuid, uuid, uuid),
  top_studios_by_reviewed_games(int),
  game_rank_stats(uuid, uuid, int),
  game_scores_by_slug(text[]),
  reviewer_volume_percentile(uuid),
  profile_game_community_stats(uuid),
  hub_game_review_stats(uuid, uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  ranked_games(int, int, int),
  review_score_summary(),
  most_reviewed_games(int, uuid, uuid, uuid),
  top_studios_by_reviewed_games(int),
  game_rank_stats(uuid, uuid, int),
  game_scores_by_slug(text[]),
  reviewer_volume_percentile(uuid),
  profile_game_community_stats(uuid),
  hub_game_review_stats(uuid, uuid, uuid)
TO service_role;
