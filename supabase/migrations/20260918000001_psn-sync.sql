-- PSN sync fields on profiles
--
-- Auth model: user pastes an NPSSO token from ca.account.sony.com; we exchange
-- it for an access + refresh token pair via Sony's OAuth (unofficial API, no
-- registered app / redirect). Tokens are stored plaintext, matching the norm in
-- this ecosystem (psn-api docs, PSNProfiles support flow). Refresh token TTL is
-- ~60 days — when it expires we prompt the user to paste NPSSO again.
--
-- Sync mechanics: mirror the Steam achievement sync's cursor + snapshot model
-- for trophies (Netlify 10s timeout). psn_sync_cursor is a jsonb envelope so
-- we can carry npCommunicationId + trophyGroupId offsets forward.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS psn_account_id         text,
  ADD COLUMN IF NOT EXISTS psn_online_id          text,
  ADD COLUMN IF NOT EXISTS psn_access_token       text,
  ADD COLUMN IF NOT EXISTS psn_refresh_token      text,
  ADD COLUMN IF NOT EXISTS psn_token_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS psn_synced_at          timestamptz,
  ADD COLUMN IF NOT EXISTS psn_trophies_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS psn_sync_cursor        jsonb,
  ADD COLUMN IF NOT EXISTS psn_sync_snapshot      jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_psn_account_id_key
  ON profiles(psn_account_id) WHERE psn_account_id IS NOT NULL;

-- PSN identifiers + trophy progress on per-game tracking rows.
--
-- Same-game-on-different-platform note: Persona 5 Royal on PS4 vs PS5 has two
-- different npCommunicationIds, but both resolve to one game_id in our DB.
-- user_game_status is UNIQUE(profile_id, game_id) so we can only store one
-- of them per user. We pick the newer platform when both exist (see the sync
-- route). Platform-filter chips in the library UI read psn_platform.
--
-- psn_playtime_minutes is only populated for PS4/PS5 games from the
-- getUserPlayedGames endpoint (matched by titleId ≠ npCommunicationId).
-- PS3 titles never have playtime; older PS4 titles may not either.
ALTER TABLE user_game_status
  ADD COLUMN IF NOT EXISTS psn_np_communication_id text,
  ADD COLUMN IF NOT EXISTS psn_platform            text,
  ADD COLUMN IF NOT EXISTS psn_trophies_earned     int,
  ADD COLUMN IF NOT EXISTS psn_trophies_total      int,
  ADD COLUMN IF NOT EXISTS psn_progress            smallint,
  ADD COLUMN IF NOT EXISTS psn_playtime_minutes    int,
  ADD COLUMN IF NOT EXISTS psn_last_played_at      timestamptz;

-- Bulk title-matching helper called by the library sync route.
-- Mirrors match_steam_games: normalized case-insensitive exact match plus a
-- trigram fallback, ranked so the "main game" wins over ports/DLC/bundles.
-- The Steam matcher was rewritten several times to handle collisions,
-- roman-numerals, and performance — start with the same shape and iterate.
CREATE OR REPLACE FUNCTION match_psn_games(psn_titles text[])
RETURNS TABLE(id uuid, title text, psn_title text) AS $$
  WITH normalized_input AS (
    SELECT DISTINCT
      t AS original,
      lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(psn_titles) AS t
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
  SELECT DISTINCT ON (id) id, title, input_title AS psn_title
  FROM ranked
  WHERE rn = 1;
$$ LANGUAGE sql STABLE;
