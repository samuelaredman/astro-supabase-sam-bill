-- Profile showcase sections the owner has hidden (from everyone, including
-- themselves). Keys match SHOWCASE_SECTIONS in src/utils/profileShowcases.ts.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hidden_showcases text[] NOT NULL DEFAULT '{}';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_hidden_showcases_keys;
ALTER TABLE profiles ADD CONSTRAINT profiles_hidden_showcases_keys
  CHECK (hidden_showcases <@ ARRAY['favorite_game', 'featured_group', 'video', 'games', 'achievements']::text[]);
