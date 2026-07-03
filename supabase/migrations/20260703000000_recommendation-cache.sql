-- Caches each profile's last computed recommendation set so repeat visits to
-- /recommendations (or the profile "Game Recs" tab) don't recompute the same
-- expensive per-game similarity + genre + social queries on every page load.
-- Served if fresh (see RECS_CACHE_TTL_MS in src/pages/api/recommendations.ts);
-- the API route bypasses this entirely when the caller passes ?refresh=1.

CREATE TABLE IF NOT EXISTS recommendation_cache (
  profile_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE recommendation_cache ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE policies — this is an internal cache written and
-- read only by the admin client from src/pages/api/recommendations.ts.
