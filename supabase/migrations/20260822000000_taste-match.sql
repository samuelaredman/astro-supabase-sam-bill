-- Taste matching: compare two reviewers' scoring tastes.
--
-- 1. profiles.taste_match_enabled — opt-out flag. On by default (a user's reviews
--    are already public); a user can hide themselves from taste comparisons via
--    Settings. Application code checks this on the *target* profile before returning
--    a comparison.
-- 2. taste_matches — internal cache of the computed comparison between an unordered
--    pair of profiles. Keyed on (profile_a, profile_b) with profile_a < profile_b so
--    (A,B) and (B,A) collapse to one row. data holds the full computed JSON payload
--    (headline %, shared games, agreements/disagreements, per-genre breakdown);
--    computed_at drives a TTL check in src/utils/tasteMatch.ts (bypassed with ?refresh=1).
--    Mirrors recommendation_cache: RLS on with NO policies, so it is written and read
--    only by the service-role admin client.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS taste_match_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.taste_match_enabled IS
  'When true (default), other users can see their taste match against this profile. Set false to opt out via Settings.';

CREATE TABLE IF NOT EXISTS public.taste_matches (
  profile_a   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_b   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_a, profile_b),
  CHECK (profile_a < profile_b)
);

ALTER TABLE public.taste_matches ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — this is an internal cache written and
-- read only by the admin client from src/utils/tasteMatch.ts.
