-- Add a fourth completion status option, 'extras', slotting between 'main' and
-- 'platinum'. Represents "finished main story + post-game / side content" —
-- i.e. HLTB's Main + Extras. The CHECK constraint is dropped and re-added
-- because the previous one was an anonymous column CHECK and Postgres won't
-- let us edit it in place.

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_completion_status_check;

-- Find and drop any anonymous CHECK constraint on completion_status. The one
-- created by the previous migration has an auto-generated name; look it up
-- and drop it explicitly so we can replace it with a named one.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'reviews'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%completion_status%'
      AND pg_get_constraintdef(oid) NOT LIKE '%platinum_hours%'
  LOOP
    EXECUTE format('ALTER TABLE reviews DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_completion_status_check
  CHECK (completion_status IS NULL OR completion_status IN ('dnf', 'main', 'extras', 'platinum'));
