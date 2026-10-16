-- Profile badges — admin-assignable status markers like "Chekpoint Creator".
-- Keyed by a stable text slug so new badge types can be added by shipping a
-- new entry in src/utils/badges.ts, no schema change needed.

CREATE TABLE IF NOT EXISTS profile_badges (
  profile_id   uuid         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_slug   text         NOT NULL,
  assigned_by  uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, badge_slug)
);

CREATE INDEX IF NOT EXISTS profile_badges_slug_idx ON profile_badges (badge_slug);

ALTER TABLE profile_badges ENABLE ROW LEVEL SECURITY;

-- Everyone can read who has what badge (badges are a public status, like a
-- "verified" check — only useful if other users can see it).
DROP POLICY IF EXISTS "profile_badges_select_all" ON profile_badges;
CREATE POLICY "profile_badges_select_all" ON profile_badges FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies — writes only via service_role from the
-- /api/admin/users/badges endpoint, which gates on requireAdmin.
