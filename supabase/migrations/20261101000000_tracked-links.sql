-- tracked_links — short links (chekpoint.gg/r/<code>) for our own promotions and
-- for creators, so signups can be traced to the link that brought them in.
--
-- /r/<code> counts the click and redirects to `destination` with ?ref=<code>
-- added. The ref travels in the URL (never a cookie) to /signup, which records
-- the link on the new profile (profiles.signup_link_id, next migration).
--
--   code        lowercase letters, digits and dashes — the part after /r/
--   destination a path on our own site ('/giveaway', '/groups/…'), never a full
--               URL, so a link can't be turned into an open redirect
--   campaign_id optional — groups links under a marketing_campaigns row
--   owner_profile_id optional — the creator a link belongs to (creator-facing
--               link pages come later; admins manage everything for now)
--   clicks      a plain counter, no per-click rows: nothing about the visitor
--               is stored. Known link-preview bots aren't counted.
--
-- RLS enabled with no policies, like marketing_campaigns: service role only.

CREATE TABLE IF NOT EXISTS tracked_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text        NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  label             text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  destination       text        NOT NULL DEFAULT '/'
                                CHECK (destination ~ '^/(?!/)' AND char_length(destination) <= 300),
  campaign_id       uuid        REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  owner_profile_id  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  clicks            int         NOT NULL DEFAULT 0,
  created_by        uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracked_links_campaign_id_idx ON tracked_links (campaign_id);
CREATE INDEX IF NOT EXISTS tracked_links_owner_profile_id_idx ON tracked_links (owner_profile_id);

ALTER TABLE tracked_links ENABLE ROW LEVEL SECURITY;

-- Counts one click and returns where to send the visitor, in one round trip.
-- NULL when the code doesn't exist.
CREATE OR REPLACE FUNCTION track_link_click(p_code text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tracked_links SET clicks = clicks + 1
   WHERE code = lower(p_code)
  RETURNING destination;
$$;

REVOKE ALL ON FUNCTION track_link_click(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION track_link_click(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION track_link_click(text) TO service_role;
