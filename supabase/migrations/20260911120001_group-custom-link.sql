-- Custom short link for a group: chekpoint.gg/c/<slug> redirects to the group.
-- For creator groups, whose link goes in video descriptions. Set by site admins
-- only (POST /api/groups/slug); NULL for every other group.
--
-- Lowercase letters, digits and inner hyphens, 3–32 characters. The app
-- lowercases before writing and looking up, so the plain UNIQUE is enough.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_slug_format;
ALTER TABLE groups ADD CONSTRAINT groups_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_slug_key;
ALTER TABLE groups ADD CONSTRAINT groups_slug_key UNIQUE (slug);
