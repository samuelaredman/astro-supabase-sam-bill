-- Social/creator links + custom profile accent color, for creator-outreach profile enhancements
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS twitch_url  text,
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS twitter_url text,
  ADD COLUMN IF NOT EXISTS discord_url text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS accent_color text;
