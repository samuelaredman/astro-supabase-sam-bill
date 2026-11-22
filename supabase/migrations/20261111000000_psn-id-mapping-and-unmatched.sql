-- Persistent PSN → games mapping so library sync stops depending on fragile
-- title normalization. Problem: Sony's getUserTitles returns a trophy-title
-- display name that rarely matches IGDB's exact title (™, "EA SPORTS" prefix,
-- colons like "Star Wars: Battlefront II", multiple games sharing a name like
-- "Ratchet & Clank"). The old match_psn_games did lowercase-exact + trigram
-- fallback and silently dropped anything that didn't clear 0.9, so Apex
-- Legends, College Football 25/26, SW Battlefront II (2017), Ratchet & Clank
-- (2016) all missed on real user libraries.
--
-- Fix: once a game is matched *once* — by title, by admin pick, by anything —
-- store the npCommunicationId on games.psn_np_communication_id. Every future
-- sync for every user hits a direct FK-style lookup instead of fuzzy matching.
-- The matcher below does ID first and only falls back to title for first-sight
-- games.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS psn_np_communication_id text;

-- Partial unique index — only enforced on populated rows so pre-existing games
-- without a PSN mapping don't collide with each other. Also lets us treat the
-- column as the authoritative "this npCommId already resolves to a game" check.
CREATE UNIQUE INDEX IF NOT EXISTS games_psn_np_communication_id_key
  ON games(psn_np_communication_id)
  WHERE psn_np_communication_id IS NOT NULL;

-- Updated matcher — ID match first, then the normalized title + trigram
-- fallback as before. Takes two parallel arrays (npCommIds[i] belongs to
-- titles[i]) so the caller can match without an extra round trip; a null
-- npCommId skips the ID branch for that input.
--
-- Returns an extra psn_np_communication_id column so the caller can
-- 1) tell which inputs hit the ID path (mapping already recorded)
-- 2) backfill mapping on title-matched rows (write psn_np_communication_id
--    onto the matched game so the next sync is an ID hit).
CREATE OR REPLACE FUNCTION match_psn_games(
  psn_titles text[],
  psn_np_comm_ids text[]
)
RETURNS TABLE(
  id uuid,
  title text,
  psn_title text,
  psn_np_communication_id text,
  matched_by text  -- 'id' or 'title'
) AS $$
  WITH input AS (
    SELECT
      t AS original_title,
      c AS np_comm_id,
      lower(regexp_replace(regexp_replace(t, '[™®©]', '', 'g'), '\s+', ' ', 'g')) AS normalized
    FROM unnest(psn_titles, psn_np_comm_ids) AS u(t, c)
  ),
  -- 1) ID match — the fast path. Once a game has psn_np_communication_id set,
  -- every future sync for every user resolves here.
  id_matches AS (
    SELECT
      g.id,
      g.title,
      i.original_title AS psn_title,
      g.psn_np_communication_id,
      'id'::text AS matched_by
    FROM input i
    JOIN games g ON g.psn_np_communication_id = i.np_comm_id
    WHERE i.np_comm_id IS NOT NULL
  ),
  -- 2) Title fallback — only for inputs that didn't hit the ID path.
  unmapped_input AS (
    SELECT i.*
    FROM input i
    WHERE NOT EXISTS (SELECT 1 FROM id_matches m WHERE m.psn_title = i.original_title)
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
    SELECT ui.original_title AS input_title, ui.np_comm_id, ng.id, ng.title, ng.igdb_category, 0 AS match_rank
    FROM normalized_games ng
    JOIN unmapped_input ui ON ng.normalized = ui.normalized
    UNION ALL
    SELECT ui.original_title AS input_title, ui.np_comm_id, g.id, g.title, g.igdb_category, 1 AS match_rank
    FROM unmapped_input ui
    JOIN games g ON g.title % ui.original_title
    WHERE similarity(g.title, ui.original_title) > 0.9
  ),
  ranked AS (
    SELECT
      c.input_title, c.np_comm_id, c.id, c.title,
      ROW_NUMBER() OVER (
        PARTITION BY c.input_title
        ORDER BY
          c.match_rank ASC,
          CASE WHEN c.igdb_category IS NULL OR c.igdb_category IN (0, 2, 4, 8, 9, 10) THEN 0 ELSE 1 END ASC,
          c.id ASC
      ) AS rn
    FROM candidates c
  ),
  title_matches AS (
    SELECT DISTINCT ON (id)
      id, title, input_title AS psn_title, np_comm_id AS psn_np_communication_id, 'title'::text AS matched_by
    FROM ranked
    WHERE rn = 1
  )
  SELECT * FROM id_matches
  UNION ALL
  SELECT * FROM title_matches;
$$ LANGUAGE sql STABLE;

-- Visibility into PSN titles that neither matched nor got auto-imported, so
-- Sam/Bill can manually import real games the matcher missed. Same model as
-- steam_unmatched_titles (see 20260703000004) — RLS on, no policies, admin
-- client only. Includes np_communication_id + platform so an admin picker can
-- resolve the IGDB game and the backfill writes the mapping in one shot.
CREATE TABLE IF NOT EXISTS psn_unmatched_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  np_communication_id text UNIQUE NOT NULL,
  title text NOT NULL,
  platform text,
  occurrences int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed boolean NOT NULL DEFAULT false
);

ALTER TABLE psn_unmatched_titles ENABLE ROW LEVEL SECURITY;
-- No policies — admin-only, same as steam_unmatched_titles.

CREATE OR REPLACE FUNCTION log_unmatched_psn_titles(
  np_comm_ids text[],
  titles text[],
  platforms text[]
)
RETURNS void AS $$
  INSERT INTO psn_unmatched_titles (np_communication_id, title, platform)
  SELECT u.c, u.t, u.p
  FROM unnest(np_comm_ids, titles, platforms) AS u(c, t, p)
  WHERE u.c IS NOT NULL AND trim(u.t) <> ''
  ON CONFLICT (np_communication_id) DO UPDATE SET
    occurrences = psn_unmatched_titles.occurrences + 1,
    last_seen_at = now(),
    title = EXCLUDED.title,
    platform = EXCLUDED.platform;
$$ LANGUAGE sql;
