-- Forum polls can now reference a game directly, and owners can choose to let
-- every member create a poll (not just admins/owners/can_edit_group roles).
--
--  * group_polls.game_id  : optional FK to games. Featured-game polls still use
--    featured_game_id (which points at group_featured_games); game_id is the
--    picker on an ordinary forum poll. Nothing stops a poll from having both,
--    but the create API picks featured_game_id's game for featured polls.
--  * groups.polls_everyone : when true, any member can create a forum poll.

ALTER TABLE group_polls
  ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES games(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_polls_game ON group_polls (game_id);

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS polls_everyone boolean NOT NULL DEFAULT false;

-- Pinned polls float to the top of the Forums > Polls list. Only owners/admins
-- (and can_edit_group custom roles) can pin, same as announcements.
ALTER TABLE group_polls
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_group_polls_group_pinned ON group_polls (group_id, pinned DESC, created_at DESC);

-- Overview Polls showcase shows exactly ONE poll, chosen by the owner:
--   'latest'   = newest non-featured poll (default)
--   'pinned'   = newest pinned poll, fall back to latest if none pinned
--   'featured' = a specific poll chosen in polls_showcase_poll_id
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS polls_showcase_mode text NOT NULL DEFAULT 'latest';

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_polls_showcase_mode_check;
ALTER TABLE groups ADD CONSTRAINT groups_polls_showcase_mode_check
  CHECK (polls_showcase_mode IN ('latest', 'pinned', 'featured'));

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS polls_showcase_poll_id uuid REFERENCES group_polls(id) ON DELETE SET NULL;
