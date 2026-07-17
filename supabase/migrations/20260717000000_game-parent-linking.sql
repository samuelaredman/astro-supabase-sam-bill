-- ─────────────────────────────────────────────────────────────────────────────
--  Game parent linking
--  Adds a self-referential parent link on games so DLC, expansions, and alternate
--  editions can point at their base game (e.g. Phantom Liberty -> Cyberpunk 2077).
--  Populated from IGDB's parent_game / version_parent fields on import + backfill.
--  Nullable — main games have no parent. ON DELETE SET NULL so removing a base game
--  orphans its children rather than cascading their deletion.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS parent_game_id UUID REFERENCES games(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS games_parent_game_id_idx ON games(parent_game_id);
