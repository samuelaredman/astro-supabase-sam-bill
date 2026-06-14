-- ─────────────────────────────────────────────────────────────────────────────
--  Game lists: lists, list_entries, list_saves + RLS + updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. lists table
CREATE TABLE IF NOT EXISTS lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  is_ranked   BOOLEAN NOT NULL DEFAULT false,
  visibility  TEXT NOT NULL DEFAULT 'public'
              CHECK (visibility IN ('public', 'private')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lists_profile_id_idx  ON lists (profile_id);
CREATE INDEX IF NOT EXISTS lists_updated_at_idx  ON lists (updated_at DESC);

-- 2. list_entries table
CREATE TABLE IF NOT EXISTS list_entries (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id   UUID NOT NULL REFERENCES lists(id)  ON DELETE CASCADE,
  game_id   UUID NOT NULL REFERENCES games(id)  ON DELETE CASCADE,
  position  INT,
  notes     TEXT,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, game_id)
);

-- No two entries in the same ranked list share a position
CREATE UNIQUE INDEX IF NOT EXISTS list_entries_position_unique
  ON list_entries (list_id, position)
  WHERE position IS NOT NULL;

CREATE INDEX IF NOT EXISTS list_entries_list_id_idx ON list_entries (list_id);
CREATE INDEX IF NOT EXISTS list_entries_game_id_idx ON list_entries (game_id);

-- 3. list_saves table
CREATE TABLE IF NOT EXISTS list_saves (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID NOT NULL REFERENCES lists(id)    ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, profile_id)
);

CREATE INDEX IF NOT EXISTS list_saves_list_id_idx    ON list_saves (list_id);
CREATE INDEX IF NOT EXISTS list_saves_profile_id_idx ON list_saves (profile_id);

-- 4. Trigger: bump lists.updated_at whenever entries are added, changed, or removed
CREATE OR REPLACE FUNCTION touch_list_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lists SET updated_at = now()
  WHERE id = COALESCE(NEW.list_id, OLD.list_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS list_entries_touch_updated_at ON list_entries;
CREATE TRIGGER list_entries_touch_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON list_entries
  FOR EACH ROW EXECUTE FUNCTION touch_list_updated_at();

-- 5. RLS on lists
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;

-- Public lists visible to everyone; private lists only to owner
CREATE POLICY "lists_select" ON lists FOR SELECT USING (
  visibility = 'public'
  OR profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "lists_insert" ON lists FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "lists_update" ON lists FOR UPDATE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

CREATE POLICY "lists_delete" ON lists FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);

-- 6. RLS on list_entries (inherits parent list visibility)
ALTER TABLE list_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "list_entries_select" ON list_entries FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_entries.list_id
      AND (
        lists.visibility = 'public'
        OR lists.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
      )
  )
);

CREATE POLICY "list_entries_insert" ON list_entries FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_entries.list_id
      AND lists.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "list_entries_update" ON list_entries FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_entries.list_id
      AND lists.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

CREATE POLICY "list_entries_delete" ON list_entries FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_entries.list_id
      AND lists.profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  )
);

-- 7. RLS on list_saves
ALTER TABLE list_saves ENABLE ROW LEVEL SECURITY;

-- Save counts and "did I save this" checks are public
CREATE POLICY "list_saves_select" ON list_saves FOR SELECT USING (true);

-- Can only save public lists, and only as yourself
CREATE POLICY "list_saves_insert" ON list_saves FOR INSERT WITH CHECK (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM lists
    WHERE lists.id = list_saves.list_id
      AND lists.visibility = 'public'
  )
);

-- Can only remove your own saves
CREATE POLICY "list_saves_delete" ON list_saves FOR DELETE USING (
  profile_id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
);
