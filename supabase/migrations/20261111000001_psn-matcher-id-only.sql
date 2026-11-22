-- Drop the title fallback in match_psn_games entirely. It was the root cause
-- of the Ratchet & Clank 2002-vs-2016 disaster from 20261111000000: when the
-- games table has multiple rows sharing a normalized title, the tie-breaker
-- (ORDER BY c.id ASC) is effectively arbitrary, and the subsequent backfill
-- in sync-library.ts cemented the wrong pick onto games.psn_np_communication_id
-- for every future user. Fuzzy title matching is fundamentally unable to
-- disambiguate re-releases ("Ratchet & Clank" on PS2 vs the PS4 remake), and
-- platform filtering alone can't solve it either (PS2-on-PS4 Classics ports
-- share the platform list with legitimate remakes).
--
-- From here on PSN → chekpoint seeding happens entirely in sync-library.ts's
-- IGDB auto-import pass, where we can layer multiple filters (platform +
-- alternative-names via IGDB's `search` + first_release_date upper bound from
-- the user's lastUpdatedDateTime) and queue ambiguous cases for admin review
-- instead of guessing. Once seeded, every future sync for every user hits the
-- ID fast path and the title ambiguity never comes up again.

-- 1) Unpoison the mappings we wrote during the brief window the fuzzy title
--    fallback was in place. We can't tell correct mappings from wrong ones, so
--    trust nothing and let the new deterministic path re-seed.
UPDATE games
SET psn_np_communication_id = NULL
WHERE psn_np_communication_id IS NOT NULL;

-- 2) Drop both lingering signatures. The 1-arg version from 20260918000001 was
--    never dropped by the 2-arg CREATE OR REPLACE in 20261111000000 (Postgres
--    treats different-arity functions as distinct), and we don't want either.
DROP FUNCTION IF EXISTS match_psn_games(text[]);
DROP FUNCTION IF EXISTS match_psn_games(text[], text[]);

-- 3) ID-only matcher. Takes the user's npCommunicationIds and returns the
--    chekpoint game_id for any that are already mapped on games. Nothing else;
--    first-sight titles are handled by the IGDB pass in sync-library.ts.
CREATE OR REPLACE FUNCTION match_psn_games(psn_np_comm_ids text[])
RETURNS TABLE(id uuid, psn_np_communication_id text) AS $$
  SELECT g.id, g.psn_np_communication_id
  FROM games g
  WHERE g.psn_np_communication_id = ANY(psn_np_comm_ids);
$$ LANGUAGE sql STABLE;
