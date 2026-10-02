-- Steam review import
-- -------------------
-- Reuses the existing import_jobs / import_job_items tables (introduced for
-- Backloggd) so the whole pipeline — scrape, resume, per-item counters,
-- needs-mapping UI — stays a single code path. Only what's Steam-specific
-- lives here:
--
--   import_job_items.steam_appid       — the appid parsed from /app/<id>/ on the
--                                        recommendations page. Used to match
--                                        the review to a Chekpoint game via
--                                        user_game_status.steam_appid before
--                                        falling back to title matching.
--   import_job_items.hours_at_review   — hours at review time (Steam prints
--                                        both current + at-review; we keep
--                                        at-review, falling back to current
--                                        when Steam only shows one number).
--                                        Stored as numeric; rounded to int
--                                        when written to reviews.play_time_hours.
--   profiles.steam_reviews_import_done_at
--                                      — one-time signal for the onboarding
--                                        wizard's "import from Steam" step,
--                                        mirrors backloggd_import_done_at.
--
-- The Backloggd fields on import_job_items (rating / release_year /
-- play_status / game_slug) stay nullable and are simply left null for
-- Steam items — Steam reviews have no score, and the game_slug column is
-- already nullable-in-practice via the review pipeline (Steam matches by
-- appid, not slug).

ALTER TABLE import_job_items ADD COLUMN IF NOT EXISTS steam_appid INT;
ALTER TABLE import_job_items ADD COLUMN IF NOT EXISTS hours_at_review NUMERIC(8, 1);

-- game_slug stays NOT NULL to keep the Backloggd flow's typing intact; Steam
-- items write an empty string in its place (they identify their game by
-- appid + title, and game_slug is only read by the Backloggd matcher).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_reviews_import_done_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS import_job_items_appid_idx
  ON import_job_items (steam_appid)
  WHERE steam_appid IS NOT NULL;
