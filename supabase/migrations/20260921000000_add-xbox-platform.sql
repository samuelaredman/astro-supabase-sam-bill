-- Store the Xbox console family each imported title belongs to, so the
-- Library page's Platform filter can split Xbox rows into 'Xbox 360' /
-- 'Xbox One' / 'Xbox Series X|S' the same way psn_platform splits PS3 /
-- PS4 / PS5. OpenXBL's /player/titleHistory returns a `devices` array on
-- each title; the Xbox library sync collapses that to a single primary
-- console (newest generation the game supports) and writes it here.
--
-- Nullable — pre-existing xbox rows keep NULL until the user re-syncs
-- via the Library page's sync dropdown, at which point they get filled
-- in. The filter treats NULL xbox rows as a generic "Xbox" bucket so
-- they remain accessible without a forced re-sync.

ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS xbox_platform text;
