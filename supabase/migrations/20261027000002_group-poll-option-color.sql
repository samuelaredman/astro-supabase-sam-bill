-- Poll options can carry a chart color so the pie slices match what the
-- poll creator picked. Null means fall back to the default palette on render.
--
-- Format is #rrggbb (lowercase), same shape as groups.accent_color /
-- profiles.accent_color — enforced by a CHECK so bad values can't sneak in.

ALTER TABLE group_poll_options
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE group_poll_options DROP CONSTRAINT IF EXISTS group_poll_options_color_check;
ALTER TABLE group_poll_options ADD CONSTRAINT group_poll_options_color_check
  CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$');
