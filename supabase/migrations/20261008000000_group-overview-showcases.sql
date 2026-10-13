-- The group Overview as showcases, like a profile's: whoever can edit the group
-- picks the order of its sections and hides the ones they don't want, and can
-- show a video (the owner's latest upload, or one featured video).
-- Keys match GROUP_SHOWCASE_SECTIONS in src/utils/groupShowcases.ts.
--
-- overview_order: empty = default order; keys it doesn't list render after it
--   in the default order.
-- overview_hidden: NULL = never customized, so the page falls back to the
--   default hidden set plus any section switched off in stats_config.

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS overview_order text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS overview_hidden text[],
  ADD COLUMN IF NOT EXISTS showcase_video_mode text,
  ADD COLUMN IF NOT EXISTS showcase_video_id text;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_overview_order_keys;
ALTER TABLE groups ADD CONSTRAINT groups_overview_order_keys
  CHECK (overview_order <@ ARRAY[
    'now_featuring', 'video', 'announcements', 'top_games', 'top_rated', 'hot_take', 'agreement',
    'hidden_gems', 'critic_spectrum', 'score_distribution', 'recent_reviews', 'polls', 'want_to_play'
  ]::text[]);

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_overview_hidden_keys;
ALTER TABLE groups ADD CONSTRAINT groups_overview_hidden_keys
  CHECK (overview_hidden IS NULL OR overview_hidden <@ ARRAY[
    'now_featuring', 'video', 'announcements', 'top_games', 'top_rated', 'hot_take', 'agreement',
    'hidden_gems', 'critic_spectrum', 'score_distribution', 'recent_reviews', 'polls', 'want_to_play'
  ]::text[]);

-- Same rules as profiles.showcase_video_*: 'latest' = the owner's newest upload,
-- 'featured' = one chosen video, NULL = off. Only the 11-char id is stored.
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_showcase_video_mode_check;
ALTER TABLE groups ADD CONSTRAINT groups_showcase_video_mode_check
  CHECK (showcase_video_mode IS NULL OR showcase_video_mode IN ('latest', 'featured'));
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_showcase_video_id_format;
ALTER TABLE groups ADD CONSTRAINT groups_showcase_video_id_format
  CHECK (showcase_video_id IS NULL OR showcase_video_id ~ '^[A-Za-z0-9_-]{11}$');
