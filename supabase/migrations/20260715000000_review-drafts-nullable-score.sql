-- ─────────────────────────────────────────────────────────────────────────────
--  Review drafts: allow a review to be saved as a draft before it's complete.
--  reviews.status ('published' | 'draft') and reviews.published_at (nullable)
--  already exist; `score` and `title` are NOT NULL and block a partial draft.
--  Make both nullable — the application layer enforces a valid 1–10 score and a
--  title at publish time, and every public read filters status = 'published', so
--  an incomplete draft is never surfaced. `body` stays NOT NULL: a draft must have
--  some review text to be worth saving.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reviews ALTER COLUMN score DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN title DROP NOT NULL;
