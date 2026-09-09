-- Extra profile link fields for the redesigned social-links editor (brand-icon
-- tiles). These are plain external-URL columns, validated in
-- src/pages/api/profile/update.ts like the existing *_url columns.
--
-- steam_url is a manually-entered Steam *profile* link and is unrelated to the
-- Steam OAuth import (steam_id / steam_username / steam_synced_at).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS steam_url              text,
  ADD COLUMN IF NOT EXISTS psn_url                text,
  ADD COLUMN IF NOT EXISTS xbox_url               text,
  ADD COLUMN IF NOT EXISTS instagram_url          text,
  ADD COLUMN IF NOT EXISTS tiktok_url             text,
  ADD COLUMN IF NOT EXISTS bluesky_url            text,
  ADD COLUMN IF NOT EXISTS retroachievements_url  text;

-- The legacy free-form profiles.website_url column is left in place (unused by
-- the profile UI now; the developers table still has its own website_url).
