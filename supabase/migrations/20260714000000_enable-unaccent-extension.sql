-- Game search (search_games) and slug generation currently have no
-- diacritic-folding step anywhere in the pipeline, so a title containing an
-- accented character (e.g. "Ö") can't be found by a query typed without the
-- accent, and vice versa. unaccent() is the standard Postgres fix for this —
-- installing the extension here as a separate, low-risk step; search_games
-- itself will be updated in a follow-up migration once its current
-- definition is captured (it predates migration tracking, so it isn't in
-- this repo yet and must not be blindly overwritten).

CREATE EXTENSION IF NOT EXISTS unaccent;
