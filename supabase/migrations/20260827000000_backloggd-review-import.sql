-- Backloggd review import
-- ------------------------
-- New users migrating from Backloggd can arrive with hundreds of written
-- reviews. This feature scrapes their public Backloggd reviews (Backloggd has no
-- API and its CSV export is ratings-only), matches each game to our IGDB-backed
-- `games` table, and writes native `reviews` rows.
--
-- The work is chunked and driven by a client loop (Netlify has no background
-- functions here), so it needs a persisted job + per-item state:
--   import_jobs       — one row per import run, holds status + running counters
--   import_job_items  — one row per scraped Backloggd review, processed in batches
--
-- Also adds profiles.backloggd_import_done_at as the one-time signal that the
-- new-user onboarding wizard's "import from Backloggd" step has been completed
-- or skipped (so it never reappears).

-- ── import_jobs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source               TEXT NOT NULL DEFAULT 'backloggd',
  backloggd_username    TEXT,
  -- 'scraping' -> 'importing' -> 'complete' | 'failed'
  status               TEXT NOT NULL DEFAULT 'scraping',
  total_pages          INT,
  scraped_pages        INT NOT NULL DEFAULT 0,
  total_items          INT NOT NULL DEFAULT 0,
  processed_items      INT NOT NULL DEFAULT 0,
  imported_count       INT NOT NULL DEFAULT 0,
  draft_count          INT NOT NULL DEFAULT 0,
  skipped_count        INT NOT NULL DEFAULT 0,
  needs_mapping_count  INT NOT NULL DEFAULT 0,
  failed_count         INT NOT NULL DEFAULT 0,
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_jobs_profile_idx ON import_jobs (profile_id, created_at DESC);

-- At most one live job per user.
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_one_active_per_profile
  ON import_jobs (profile_id)
  WHERE status IN ('scraping', 'importing');

-- ── import_job_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_job_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  -- 'pending' -> 'imported' | 'drafted' | 'skipped' | 'needs_mapping' | 'failed'
  status             TEXT NOT NULL DEFAULT 'pending',
  game_slug          TEXT NOT NULL,
  game_title         TEXT NOT NULL,
  release_year       INT,
  rating             NUMERIC(2, 1),
  review_text        TEXT NOT NULL,
  review_date        DATE,
  platform_name      TEXT,
  play_status        TEXT,
  contains_spoilers  BOOLEAN NOT NULL DEFAULT false,
  source_url         TEXT,
  matched_game_id    UUID REFERENCES games(id) ON DELETE SET NULL,
  review_id          UUID REFERENCES reviews(id) ON DELETE SET NULL,
  detail             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS import_job_items_job_status_idx ON import_job_items (job_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Owner may read their own job + items (for the progress UI). All writes go
-- through API routes on the service-role client, so no write policies.
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_jobs_select" ON import_jobs FOR SELECT USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "import_job_items_select" ON import_job_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM import_jobs j
    WHERE j.id = import_job_items.job_id
      AND j.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

-- ── onboarding gate ──────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS backloggd_import_done_at TIMESTAMPTZ;
