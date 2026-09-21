-- Cache table for the single Chekpoint-controlled PSN service credential.
--
-- The service token is bootstrapped once at server start (or at first use) by
-- exchanging the PSN_SERVICE_NPSSO env var for a Sony refresh token. From then
-- on the refresh token is what matters — Sony rolls it forward on each use, so
-- as long as any sync fires within ~60 days it stays valid indefinitely.
--
-- Storing it in a DB row (rather than only in memory / env vars) lets a fresh
-- serverless function instance skip the NPSSO exchange when a valid refresh
-- token is already on file — the NPSSO itself only needs to be used once
-- across all deploys.
--
-- Single-row pattern: id is a constant text 'singleton' so INSERT / UPDATE /
-- SELECT always target the same row. No profile ownership, no RLS needed —
-- only the admin client (service role) ever touches this.
CREATE TABLE IF NOT EXISTS psn_service_auth (
  id                       text        PRIMARY KEY DEFAULT 'singleton'
                             CHECK (id = 'singleton'),
  refresh_token            text        NOT NULL,
  access_token             text,
  access_token_expires_at  timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE psn_service_auth ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role reads/writes. authenticated / anon are blocked.
