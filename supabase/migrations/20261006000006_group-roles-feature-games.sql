-- Custom group roles can be allowed to feature games on the Games tab.
-- Owners and admins always can.
ALTER TABLE group_roles
  ADD COLUMN IF NOT EXISTS can_feature_games bool NOT NULL DEFAULT false;
