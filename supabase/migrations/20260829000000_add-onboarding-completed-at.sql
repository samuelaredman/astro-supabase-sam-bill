-- Tracks when a user completed (or was grandfathered past) the onboarding wizard.
-- NULL means the wizard should be shown; non-NULL means skip it.
-- Existing users are grandfathered via a manual data migration run after this deploys.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
