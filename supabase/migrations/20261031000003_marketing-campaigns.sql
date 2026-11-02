-- marketing_campaigns — date windows for promotions (giveaways, creator pushes,
-- ads), so the admin Activity page can mark them on the chart and compare the
-- retention of users who signed up during each one against organic signups.
--
-- Days are UTC dates, matching admin_daily_activity's day buckets. `ends_on`
-- NULL means the campaign is still running. Both ends are inclusive.
--
-- Same security model as site_admins / reports: RLS enabled with no policies,
-- so only the service role (admin API routes and pages) can read or write.

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind        text        NOT NULL DEFAULT 'other'
                          CHECK (kind IN ('giveaway', 'creator', 'ad', 'social', 'other')),
  starts_on   date        NOT NULL,
  ends_on     date,
  notes       text        CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_starts_on_idx ON marketing_campaigns (starts_on DESC);

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
