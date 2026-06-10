-- Steam sync fields on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS steam_id       text,
  ADD COLUMN IF NOT EXISTS steam_username text,
  ADD COLUMN IF NOT EXISTS steam_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_steam_id_key
  ON profiles(steam_id) WHERE steam_id IS NOT NULL;

-- Steam playtime on per-game tracking rows
ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS steam_playtime_minutes int;

-- Bulk title-matching helper called by the import route.
-- Matches Steam game names against our games table case-insensitively.
CREATE OR REPLACE FUNCTION match_steam_games(steam_titles text[])
RETURNS TABLE(id uuid, title text) AS $$
  SELECT g.id, g.title
  FROM games g
  WHERE lower(g.title) = ANY(
    SELECT lower(t) FROM unnest(steam_titles) AS t
  );
$$ LANGUAGE sql STABLE;
