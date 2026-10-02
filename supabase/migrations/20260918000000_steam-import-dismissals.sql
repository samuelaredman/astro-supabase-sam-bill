-- Persist a user's decision to dismiss a Steam-import conflict so re-imports
-- don't keep re-surfacing the same appid. Populated when the user clicks
-- "Keep mine" on a draft conflict card (they've reconciled once, don't want
-- to be asked again).
--
-- The delete-a-Steam-imported-draft case is handled implicitly by the
-- soft-delete semantics on `reviews` (`status='deleted'`): importItem.ts
-- treats an existing deleted row as an implicit dismissal without needing an
-- entry here, so we only ever write here for the explicit "Keep mine" flow.

CREATE TABLE IF NOT EXISTS steam_import_dismissals (
  profile_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  steam_appid    INT         NOT NULL,
  dismissed_via  TEXT        NOT NULL, -- 'keep_mine' today; leave room for future reasons
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, steam_appid)
);

ALTER TABLE steam_import_dismissals ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies. Anon and authenticated clients cannot read or
-- write. All access goes through the admin client from server routes, which
-- bypasses RLS (matches the `contact_submissions` / `reports` pattern).
