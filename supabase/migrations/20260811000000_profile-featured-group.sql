-- Lets a user feature any group they belong to ("Join my community") on their profile page
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS featured_group_id uuid REFERENCES groups(id) ON DELETE SET NULL;
