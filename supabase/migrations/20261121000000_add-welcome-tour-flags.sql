-- Onboarding redesign: replaces the blocking OnboardingWizard modal with a
-- /welcome showcase page + a resumable in-app tour. Two new flags on profiles
-- drive that:
--   welcome_seen_at   — the /welcome page has been shown to this user. Until
--                       set, Layout redirects every page they hit to /welcome.
--                       Set by both the primary CTA and the Skip link.
--   tour_completed_at — the chained profile→review tour has finished at least
--                       once. Until set (but after welcome_seen_at), a
--                       "Finish setup" chip in the sidebar lets them resume.
--
-- Backfill for existing users: anyone who was already past onboarding
-- (onboarding_completed_at IS NOT NULL — including the historical grandfather
-- migration that stamped all pre-existing accounts) is marked as having seen
-- the welcome page and completed the tour, so they aren't retroactively
-- bounced to /welcome or prompted to re-finish setup.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS welcome_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz;

UPDATE profiles
  SET welcome_seen_at = COALESCE(welcome_seen_at, onboarding_completed_at),
      tour_completed_at = COALESCE(tour_completed_at, onboarding_completed_at)
  WHERE onboarding_completed_at IS NOT NULL;
