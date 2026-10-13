-- Featured games: a creator's group shows the games they 100%, review or play
-- through, each with its video, a note and an optional poll, on the group's
-- Games tab (?tab=games). The members' numbers for each game come from
-- group_featured_game_stats() (migration 20261006000007).
--
-- Only the 11-character YouTube video id is stored (never the pasted URL), like
-- reviews.youtube_video_id, so nothing user-supplied reaches an embed src.

CREATE TABLE IF NOT EXISTS group_featured_games (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  game_id           uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  youtube_video_id  text        CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  note              text        CHECK (note IS NULL OR char_length(note) <= 500),
  created_by        uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_group_featured_games_group
  ON group_featured_games (group_id, created_at DESC);

-- Read and written only by the server (service role), like the group stats.
ALTER TABLE group_featured_games ENABLE ROW LEVEL SECURITY;

-- A featured game's poll is an ordinary group poll tied to it, so voting,
-- closing and deleting reuse /api/groups/polls/*. Overview's Polls card leaves
-- these out (featured_game_id IS NULL); they're shown on the game's card.
ALTER TABLE group_polls
  ADD COLUMN IF NOT EXISTS featured_game_id uuid REFERENCES group_featured_games(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS group_polls_featured_game_id_key
  ON group_polls (featured_game_id) WHERE featured_game_id IS NOT NULL;
