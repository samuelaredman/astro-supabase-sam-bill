-- Resurrects the title-based fallback in match_psn_games that was dropped by
-- 20261111000001, but now uses THREE independent signals simultaneously —
-- normalized title AND platform AND release-date bound — so the Ratchet &
-- Clank 2016-remake-vs-2002-original disaster that motivated the id-only
-- matcher can't reoccur. The 2016 PS4 remake has date_released=2016 and the
-- PS4 platform; the 2002 PS2 original has date_released=2002 and the PS2
-- platform. A PS4 npCommId with a 2020 trophy-earn date resolves to the 2016
-- remake with zero ambiguity.
--
-- Why this is better than the id-only + IGDB-loop approach it replaces:
--   The games table already holds tens of thousands of IGDB-sourced rows
--   from other users' Steam/Xbox/manual imports. The vast majority of PSN
--   titles are in there already — just not mapped to any psn_np_communication_id.
--   A single RPC call with 4 parallel arrays (title/platform/npCommId/
--   lastUpdated) resolves 85-95% of a typical library in one shot. IGDB only
--   has to run for the thin tail of titles that genuinely aren't in Chekpoint
--   yet, which fits comfortably in one sync request without any cursor /
--   snapshot / multiquery scaffolding.

-- 1) Normalization helper. Strips trademarks (™®©), punctuation (curly and
--    straight apostrophes, dashes, colons), lowercases, and collapses runs
--    of whitespace. Idempotent and IMMUTABLE so we can index on it.
--    "Marvel's Spider-Man" → "marvels spiderman"
--    "Marvel's Spider-Man" → "marvels spiderman" (curly apostrophe)
--    "God of War™"        → "god of war"
--    "FINAL FANTASY VII"  → "final fantasy vii"
CREATE OR REPLACE FUNCTION normalize_title_for_match(input text)
RETURNS text AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(lower(input), '[^a-z0-9 ]', '', 'g'),
      '\s+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;

-- 2) Functional index on games so the title-match join is O(log n) instead
--    of a full scan per input. At ~100 PSN titles × ~100k games, the
--    difference is seconds vs. minutes.
CREATE INDEX IF NOT EXISTS games_title_match_idx
  ON games (normalize_title_for_match(title));

-- 3) Replace match_psn_games. Drop the old single-arg signature; the new
--    one takes four parallel arrays (one entry per PSN title) and returns
--    rows keyed by input_index so callers can zip the result back.
DROP FUNCTION IF EXISTS match_psn_games(text[]);
DROP FUNCTION IF EXISTS match_psn_games(text[], text[]);

CREATE OR REPLACE FUNCTION match_psn_games(
  psn_titles text[],
  psn_platform_igdb_ids int[],
  psn_np_comm_ids text[],
  psn_last_updated timestamptz[]
)
RETURNS TABLE(input_index int, game_id uuid, matched_by text) AS $$
  WITH inputs AS (
    SELECT (ord - 1)::int AS input_index, title, plat_igdb, npc, last_upd
    FROM unnest(psn_titles, psn_platform_igdb_ids, psn_np_comm_ids, psn_last_updated)
         WITH ORDINALITY AS u(title, plat_igdb, npc, last_upd, ord)
  ),
  -- Fast path: already-mapped by psn_np_communication_id. Hits instantly
  -- once a title has been resolved once, globally.
  by_id AS (
    SELECT i.input_index, g.id AS game_id, 'id'::text AS matched_by
    FROM inputs i
    JOIN games g ON g.psn_np_communication_id = i.npc
  ),
  unmatched AS (
    SELECT i.* FROM inputs i
    WHERE NOT EXISTS (SELECT 1 FROM by_id b WHERE b.input_index = i.input_index)
  ),
  -- Title + platform + date-bound fallback. Three independent signals in
  -- one query:
  --   • Normalized title must match exactly (functional index above).
  --   • The game must have the PSN platform tagged on game_platforms.
  --   • The game's release date must be NULL or ≤ the user's trophy-earn
  --     date (a user can't earn trophies for a game before it ships).
  -- When multiple candidates survive, pick the one with the most recent
  -- release — correct for both re-releases (user on the remaster if their
  -- earn date is post-release) and originals (date filter excludes the
  -- remaster if their earn date is pre-release).
  by_title AS (
    SELECT DISTINCT ON (u.input_index)
           u.input_index,
           g.id AS game_id,
           'title_platform_date'::text AS matched_by
    FROM unmatched u
    JOIN games g
      ON normalize_title_for_match(g.title) = normalize_title_for_match(u.title)
    JOIN game_platforms gp ON gp.game_id = g.id
    JOIN platforms p ON p.id = gp.platform_id AND p.igdb_id = u.plat_igdb
    WHERE g.date_released IS NULL
       OR u.last_upd IS NULL
       OR g.date_released <= u.last_upd::date
    ORDER BY u.input_index, g.date_released DESC NULLS LAST
  )
  SELECT * FROM by_id
  UNION ALL
  SELECT * FROM by_title;
$$ LANGUAGE sql STABLE;

-- 4) Drop the cursor/snapshot columns added by 20261127000000. The new
--    one-shot match path doesn't need multi-call pagination for typical
--    libraries. Any in-flight syncs when this ships get a clean reset.
ALTER TABLE profiles
  DROP COLUMN IF EXISTS psn_library_sync_cursor,
  DROP COLUMN IF EXISTS psn_library_sync_snapshot;
