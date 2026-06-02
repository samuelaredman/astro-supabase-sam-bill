-- Add role hierarchy support to group_roles

ALTER TABLE group_roles
  ADD COLUMN IF NOT EXISTS role_rank        int  NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS can_manage_roles bool NOT NULL DEFAULT false;

-- Index for fast rank comparisons
CREATE INDEX IF NOT EXISTS group_roles_rank_idx ON group_roles (group_id, role_rank);

-- Enforce rank >= 1 (0 is reserved for owner)
ALTER TABLE group_roles
  ADD CONSTRAINT group_roles_rank_min CHECK (role_rank >= 1);
