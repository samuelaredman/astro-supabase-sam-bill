-- profiles.signup_link_id — the tracked link (chekpoint.gg/r/<code>) a user
-- signed up through, if any. Set once by /api/auth/signup right after the
-- account is created; NULL for everyone else, including all earlier signups.
-- Deleting a link keeps the profile and just forgets the attribution.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signup_link_id uuid REFERENCES tracked_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_signup_link_id_idx
  ON profiles (signup_link_id) WHERE signup_link_id IS NOT NULL;
