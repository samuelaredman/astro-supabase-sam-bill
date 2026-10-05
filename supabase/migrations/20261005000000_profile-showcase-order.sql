-- Order of the profile Overview showcase sections, set in Edit profile.
-- Empty = default order; keys it doesn't list render after it in the default
-- order. Keys match SHOWCASE_SECTIONS in src/utils/profileShowcases.ts.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS showcase_order text[] NOT NULL DEFAULT '{}';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_showcase_order_keys;
ALTER TABLE profiles ADD CONSTRAINT profiles_showcase_order_keys
  CHECK (showcase_order <@ ARRAY['favorite_game', 'featured_group', 'video', 'games', 'achievements']::text[]);
