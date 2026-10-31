-- Replaces the shared_to_feed boolean with a timestamp of the last "post to
-- feed" action. A list enters the home feed when its owner clicks the button;
-- a repost sets the timestamp to now() and the feed re-sorts the list to the
-- top. Removing from the feed clears the column back to NULL.
--
-- Backfill: any list currently flagged shared_to_feed = true keeps its spot
-- using greatest(updated_at, created_at) as a stand-in for "last posted"
-- so existing feed entries don't vanish on deploy.
--
-- shared_to_feed itself stays for one release cycle so a stale deploy of the
-- API routes can keep writing to it harmlessly; drop it in a follow-up.

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS last_posted_to_feed_at TIMESTAMPTZ;

UPDATE lists
SET last_posted_to_feed_at = GREATEST(updated_at, created_at)
WHERE shared_to_feed = true
  AND last_posted_to_feed_at IS NULL;

-- Partial index: the home feed only ever asks for rows where this is set,
-- so a full index would waste space on the (large majority of) private /
-- unposted lists.
CREATE INDEX IF NOT EXISTS lists_last_posted_to_feed_at_idx
  ON lists (last_posted_to_feed_at DESC)
  WHERE last_posted_to_feed_at IS NOT NULL;
