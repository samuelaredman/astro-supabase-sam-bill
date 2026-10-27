-- Group Overview: fold Hot take + Consensus/Divisive + Hidden gems into one
-- compact "Verdict board" strip. Keep the old keys in the CHECK list so any
-- existing overview_order / overview_hidden rows that reference them still
-- validate — groupShowcases.ts maps them to verdict_board on read.

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_overview_order_keys;
ALTER TABLE groups ADD CONSTRAINT groups_overview_order_keys
  CHECK (overview_order <@ ARRAY[
    'now_featuring', 'video', 'announcements', 'top_games', 'top_rated',
    'hot_take', 'agreement', 'hidden_gems', 'verdict_board',
    'critic_spectrum', 'score_distribution', 'recent_reviews', 'polls', 'want_to_play'
  ]::text[]);

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_overview_hidden_keys;
ALTER TABLE groups ADD CONSTRAINT groups_overview_hidden_keys
  CHECK (overview_hidden IS NULL OR overview_hidden <@ ARRAY[
    'now_featuring', 'video', 'announcements', 'top_games', 'top_rated',
    'hot_take', 'agreement', 'hidden_gems', 'verdict_board',
    'critic_spectrum', 'score_distribution', 'recent_reviews', 'polls', 'want_to_play'
  ]::text[]);
