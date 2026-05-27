-- Migrate legacy string-keyed reactions to their emoji equivalents.
-- 'heart' and 'facepalm' were the original hardcoded reaction types before
-- the emoji picker was introduced. 'sold' is being removed entirely.
-- Safe to re-run — the WHERE clauses are idempotent.

UPDATE review_reactions SET reaction_type = '❤️' WHERE reaction_type = 'heart';
UPDATE review_reactions SET reaction_type = '🤦' WHERE reaction_type = 'facepalm';
DELETE FROM review_reactions WHERE reaction_type = 'sold';
