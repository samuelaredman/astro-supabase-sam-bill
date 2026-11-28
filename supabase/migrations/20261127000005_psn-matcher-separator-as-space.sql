-- normalize_title_for_match previously stripped non-alphanumeric chars to
-- nothing: "NieR:Automata" → "nierautomata". That lost whatever separator
-- a title used, which caused real mismatches whenever PSN and IGDB disagreed
-- on separator style:
--
--   PSN: "NieR:Automata"        (no space after colon)
--   IGDB:"Nier: Automata"       (space after colon)
--   Old normalized:  "nierautomata"  vs  "nier automata"   → MISS
--   New normalized:  "nier automata" vs  "nier automata"   → MATCH
--
-- Same issue affected "Marvel's Spider-Man" vs "Marvel's Spider Man", and
-- any title where the two sources disagreed on hyphen / space / punctuation.
--
-- Fix: translate every non-alphanumeric character to a space, then collapse
-- consecutive spaces to a single space, then trim. Separators are now
-- preserved as word boundaries instead of silently joining tokens.

CREATE OR REPLACE FUNCTION normalize_title_for_match(input text)
RETURNS text AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(lower(input), '[^a-z0-9]', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;

-- The functional index references the function result. Postgres doesn't
-- auto-rebuild functional indexes when an IMMUTABLE function changes
-- (it has no way to know), so drop and recreate to repopulate with the
-- new normalized values.
DROP INDEX IF EXISTS games_title_match_idx;
CREATE INDEX games_title_match_idx
  ON games (normalize_title_for_match(title));

NOTIFY pgrst, 'reload schema';
