-- Per-group accent color, parallel to profiles.accent_color
-- (set in Edit mode on the group page, scoped under #accentScope so the
-- site chrome stays unchanged for visitors).
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS accent_color text;
