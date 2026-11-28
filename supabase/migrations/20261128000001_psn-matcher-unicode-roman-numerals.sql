-- normalize_title_for_match previously stripped Unicode Roman numeral chars
-- (Ⅰ–Ⅹ, U+2160–U+2169) along with everything else non-alphanumeric. PSN uses
-- these in titles like "DARK SOULS™ Ⅱ: Scholar of the First Sin" where the
-- game is objectively "Dark Souls II" — IGDB stores it with ASCII "II".
-- Stripping the Unicode glyph produced "dark souls scholar of the first sin"
-- on the PSN side vs "dark souls ii scholar of the first sin" on the IGDB
-- side — same intent, different normalized strings, no match.
--
-- Fix: convert the ten Roman-numeral codepoints to their ASCII equivalents
-- BEFORE the strip-non-alphanumeric step. They're all distinct single
-- codepoints that map to multi-char ASCII sequences, so a chain of
-- regexp_replace is the straightforward way (translate() is char-by-char
-- and can't do 1→many).

CREATE OR REPLACE FUNCTION normalize_title_for_match(input text)
RETURNS text AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        lower(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(
                            regexp_replace(input, 'Ⅰ', 'I', 'g'),
                          'Ⅱ', 'II', 'g'),
                        'Ⅲ', 'III', 'g'),
                      'Ⅳ', 'IV', 'g'),
                    'Ⅴ', 'V', 'g'),
                  'Ⅵ', 'VI', 'g'),
                'Ⅶ', 'VII', 'g'),
              'Ⅷ', 'VIII', 'g'),
            'Ⅸ', 'IX', 'g'),
          'Ⅹ', 'X', 'g')
        ),
        '[^a-z0-9]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;

-- Functional index references the function's output — Postgres doesn't know
-- an IMMUTABLE function's definition changed, so drop and recreate the index
-- to repopulate with the new normalized values.
DROP INDEX IF EXISTS games_title_match_idx;
CREATE INDEX games_title_match_idx
  ON games (normalize_title_for_match(title));

NOTIFY pgrst, 'reload schema';
