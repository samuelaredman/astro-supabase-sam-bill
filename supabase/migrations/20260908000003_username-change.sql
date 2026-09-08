-- Username changes from Settings: a 30-day cooldown, a 48h settling window for
-- corrections, a 31-day single-use reclaim hold on the name you leave, and a
-- rename trail so stale /reviewers/<old> links 301 to the current handle.
-- All policy lives in src/pages/api/profile/change-username.ts.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username_changed_at     timestamptz,           -- start of the current 30-day cooldown; NULL = never renamed
  ADD COLUMN IF NOT EXISTS username_prev           text,                  -- the one name currently reserved for this account
  ADD COLUMN IF NOT EXISTS username_prev_until     timestamptz,           -- when that reservation lapses
  ADD COLUMN IF NOT EXISTS username_settling_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS username_locked         boolean NOT NULL DEFAULT false;

-- username_since drives the "held it >= 30 days" tenure bar for earning a hold.
-- Backfill existing rows from account creation so nobody starts at zero tenure.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username_since timestamptz;
UPDATE profiles SET username_since = COALESCE(created_at, now()) WHERE username_since IS NULL;
ALTER TABLE profiles ALTER COLUMN username_since SET DEFAULT now();
ALTER TABLE profiles ALTER COLUMN username_since SET NOT NULL;

-- Case-insensitive lookup of a name reserved for some other account.
CREATE INDEX IF NOT EXISTS profiles_username_prev_lower_idx
  ON profiles (lower(username_prev))
  WHERE username_prev IS NOT NULL;

CREATE TABLE IF NOT EXISTS username_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_username text NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  reclaimed_at timestamptz                                                 -- set when the account takes this name back; blocks a second hold on it
);

CREATE INDEX IF NOT EXISTS username_history_old_username_lower_idx
  ON username_history (lower(old_username));
CREATE INDEX IF NOT EXISTS username_history_profile_id_idx
  ON username_history (profile_id);

-- RLS on, no policies: like `reports`, every read/write goes through the
-- service-role client. The redirect fallback and the rename endpoint use admin.
ALTER TABLE username_history ENABLE ROW LEVEL SECURITY;
