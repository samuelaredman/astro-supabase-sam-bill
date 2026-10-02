-- Xbox sync fields on profiles
--
-- Auth model: user pastes an OpenXBL (xbl.io) API key. The key IS the
-- authentication credential — no OAuth exchange like PSN — and it's
-- long-lived (until the user regenerates it at xbl.io/profile). Stored
-- plaintext, matching the rest of the ecosystem norm (see PSN comment).
--
-- Sync mechanics: mirror the PSN cursor + snapshot model for achievements.
-- xbox_sync_cursor is jsonb so we can carry a titleId offset forward.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS xbox_xuid                    text,
  ADD COLUMN IF NOT EXISTS xbox_gamertag                text,
  ADD COLUMN IF NOT EXISTS xbox_api_key                 text,
  ADD COLUMN IF NOT EXISTS xbox_synced_at               timestamptz,
  ADD COLUMN IF NOT EXISTS xbox_achievements_synced_at  timestamptz,
  ADD COLUMN IF NOT EXISTS xbox_sync_cursor             jsonb,
  ADD COLUMN IF NOT EXISTS xbox_sync_snapshot           jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_xbox_xuid_key
  ON profiles(xbox_xuid) WHERE xbox_xuid IS NOT NULL;

-- Xbox identifiers + progress on per-game tracking rows.
--
-- xbox_title_id is the numeric Xbox title identifier (stored as text — some
-- old 360 titles have hex-style IDs). max_gamerscore is the theoretical
-- ceiling (base + DLC), current_gamerscore is what the user has earned.
-- xbox_progress = 100 * current / max, rounded — precomputed so the library
-- sort doesn't recompute per row.
ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS xbox_title_id            text,
  ADD COLUMN IF NOT EXISTS xbox_current_gamerscore  int,
  ADD COLUMN IF NOT EXISTS xbox_max_gamerscore      int,
  ADD COLUMN IF NOT EXISTS xbox_progress            smallint,
  ADD COLUMN IF NOT EXISTS xbox_last_played_at      timestamptz;

-- Bulk title-matching helper called by the library sync route.
-- Mirrors match_steam_games / match_psn_games. Same normalized case-
-- insensitive exact match plus trigram fallback ranking.
CREATE OR REPLACE FUNCTION match_xbox_games(xbox_titles text[])
RETURNS TABLE(id uuid, title text, xbox_title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT
      t AS original,
      lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(xbox_titles) AS t
  ),
  normalized_games AS (
    SELECT
      g.id,
      g.title,
      g.igdb_category,
      lower(regexp_replace(regexp_replace(g.title, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM games g
  ),
  candidates AS (
    SELECT ni.original AS input_title, ng.id, ng.title, ng.igdb_category, 0 AS match_rank
    FROM normalized_games ng
    JOIN normalized_input ni ON ng.normalized = ni.normalized
    UNION ALL
    SELECT ni.original AS input_title, g.id, g.title, g.igdb_category, 1 AS match_rank
    FROM normalized_input ni
    JOIN games g ON g.title % ni.original
    WHERE similarity(g.title, ni.original) > 0.9
  ),
  ranked AS (
    SELECT
      c.input_title, c.id, c.title,
      ROW_NUMBER() OVER (
        PARTITION BY c.input_title
        ORDER BY
          c.match_rank ASC,
          CASE WHEN c.igdb_category IS NULL OR c.igdb_category IN (0, 2, 4, 8, 9, 10) THEN 0 ELSE 1 END ASC,
          c.id ASC
      ) AS rn
    FROM candidates c
  )
  SELECT DISTINCT ON (id) id, title, input_title AS xbox_title
  FROM ranked
  WHERE rn = 1;
$$ LANGUAGE sql STABLE;
