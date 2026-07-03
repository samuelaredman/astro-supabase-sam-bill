-- Logs Steam library titles that match_steam_games couldn't match to a game
-- in our DB, so Sam/Bill can review and import genuine gaps (e.g. Slay the
-- Spire 2) from an admin page instead of relying on manual, ad-hoc IGDB
-- lookups. Deliberately NOT an auto-import: bulk unsupervised import during
-- sync risked reintroducing the timeout bug (many live IGDB calls per sync)
-- and importing garbage (non-game Steam entries, ambiguous IGDB duplicates).
--
-- title_key is the dedup key (lowercased/trimmed) so re-syncs bump
-- `occurrences` on the same row instead of creating near-duplicates; `title`
-- keeps the latest original-cased spelling for display/search.
--
-- Same security model as site_admins/reports: RLS enabled, no policies, so
-- only the service-role (admin) client can read or write this table.

CREATE TABLE IF NOT EXISTS steam_unmatched_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_key text UNIQUE NOT NULL,
  title text NOT NULL,
  occurrences int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  dismissed boolean NOT NULL DEFAULT false
);

ALTER TABLE steam_unmatched_titles ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies added — all user-client access is denied by default

CREATE OR REPLACE FUNCTION log_unmatched_steam_titles(titles text[])
RETURNS void AS $$
  INSERT INTO steam_unmatched_titles (title_key, title)
  SELECT lower(trim(t)), trim(t)
  FROM unnest(titles) AS t
  WHERE trim(t) <> ''
  ON CONFLICT (title_key) DO UPDATE SET
    occurrences = steam_unmatched_titles.occurrences + 1,
    last_seen_at = now(),
    title = EXCLUDED.title;
$$ LANGUAGE sql;
