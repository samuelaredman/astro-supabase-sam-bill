-- The group feed, and the disagreement of the day.
--
-- Reading a group's reviews meant a sidebar card that listed five of them as
-- one-line rows. This adds the feed proper, plus the daily argument that runs at
-- the top of it: the group's sharpest disagreement, rotating each day, with a
-- side to take.
--
-- Both read through group_reviews(), like every other group_* function, so
-- "published, by a current member, inside the group's focus" stays in one place.

-- The feed, filtered against the viewer's own reviews.
--
-- The filters have to be applied here rather than after the rows come back:
-- filtering a page of 20 in JS would show six of them and page through the feed
-- wrongly. 'disagree' and 'unplayed' are relative to the viewer, so they exclude
-- the viewer's own reviews and fall back to 'all' for a logged-out visitor,
-- whose every row would otherwise compare against a NULL and vanish.
CREATE OR REPLACE FUNCTION group_feed(
  p_group_id uuid,
  p_viewer_profile_id uuid DEFAULT NULL,
  p_filter text DEFAULT 'all',
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS SETOF reviews
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  LEFT JOIN reviews v
    ON v.profile_id = p_viewer_profile_id
   AND v.game_id = r.game_id
   AND v.status = 'published'
  WHERE CASE
    WHEN p_viewer_profile_id IS NULL THEN true
    WHEN coalesce(p_filter, 'all') = 'disagree'
      THEN r.profile_id <> p_viewer_profile_id AND v.id IS NOT NULL AND abs(v.score - r.score) >= 3
    WHEN coalesce(p_filter, 'all') = 'unplayed'
      THEN r.profile_id <> p_viewer_profile_id AND v.id IS NULL
    ELSE true
  END;
$$;

-- The disagreement of the day: one game two members scored at least three apart,
-- with the member at each end and the review to read.
--
-- The pick is derived from the group and the date rather than stored, so it is
-- the same for everyone all day and needs no nightly job. It rotates through the
-- 30 widest disagreements rather than all of them, so the daily argument is
-- always one worth having, and the pool shifts as members review more.
CREATE OR REPLACE FUNCTION group_daily_disagreement(
  p_group_id uuid,
  p_day date,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, spread int,
  high_profile_id uuid, high_score int, high_review_id uuid,
  low_profile_id uuid, low_score int, low_review_id uuid
)
LANGUAGE sql STABLE AS $$
  WITH gr AS (
    SELECT r.id, r.game_id, r.profile_id, r.score, r.published_at
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id) r
  ), pool AS (
    SELECT gr.game_id, (max(gr.score) - min(gr.score))::int AS spread
    FROM gr
    GROUP BY gr.game_id
    HAVING max(gr.score) - min(gr.score) >= 3
    ORDER BY max(gr.score) - min(gr.score) DESC, count(*) DESC, gr.game_id
    LIMIT 30
  ), ranked AS (
    SELECT pool.game_id, pool.spread,
           row_number() OVER (ORDER BY pool.spread DESC, pool.game_id) - 1 AS rn,
           count(*) OVER () AS n
    FROM pool
  ), pick AS (
    -- hashtext can return INT_MIN, whose abs() overflows int — go through bigint
    SELECT ranked.game_id, ranked.spread
    FROM ranked
    WHERE ranked.rn = mod(abs(hashtext(p_group_id::text || p_day::text)::bigint), ranked.n)
  )
  SELECT p.game_id, p.spread,
         hi.profile_id, hi.score, hi.id,
         lo.profile_id, lo.score, lo.id
  FROM pick p
  CROSS JOIN LATERAL (
    SELECT gr.profile_id, gr.score, gr.id FROM gr
    WHERE gr.game_id = p.game_id ORDER BY gr.score DESC, gr.published_at, gr.profile_id LIMIT 1
  ) hi
  CROSS JOIN LATERAL (
    SELECT gr.profile_id, gr.score, gr.id FROM gr
    WHERE gr.game_id = p.game_id ORDER BY gr.score, gr.published_at, gr.profile_id LIMIT 1
  ) lo;
$$;

-- Which side each member took. One vote per member per group per day; the day
-- and game are stored alongside so a settled vote still reads correctly after
-- the underlying reviews change or the pick rotates on.
CREATE TABLE IF NOT EXISTS group_disagreement_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  day date NOT NULL,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  voted_for uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_disagreement_votes_one_per_day UNIQUE (group_id, day, profile_id)
);

CREATE INDEX IF NOT EXISTS group_disagreement_votes_group_day_idx
  ON group_disagreement_votes (group_id, day);

ALTER TABLE group_disagreement_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their group's votes" ON group_disagreement_votes;
CREATE POLICY "Members read their group's votes" ON group_disagreement_votes
  FOR SELECT USING (is_group_member(group_id));

DROP POLICY IF EXISTS "Members vote as themselves" ON group_disagreement_votes;
CREATE POLICY "Members vote as themselves" ON group_disagreement_votes
  FOR INSERT WITH CHECK (is_group_member(group_id) AND profile_id = get_my_profile_id());

DROP POLICY IF EXISTS "Members change their own vote" ON group_disagreement_votes;
CREATE POLICY "Members change their own vote" ON group_disagreement_votes
  FOR UPDATE USING (profile_id = get_my_profile_id()) WITH CHECK (profile_id = get_my_profile_id());

DROP POLICY IF EXISTS "Members take back their own vote" ON group_disagreement_votes;
CREATE POLICY "Members take back their own vote" ON group_disagreement_votes
  FOR DELETE USING (profile_id = get_my_profile_id());

-- How the group has voted today. Counted here rather than by reading the vote
-- rows: a creator group's day can pass 1000 votes.
CREATE OR REPLACE FUNCTION group_disagreement_tally(p_group_id uuid, p_day date)
RETURNS TABLE(voted_for uuid, votes int)
LANGUAGE sql STABLE AS $$
  SELECT v.voted_for, count(*)::int
  FROM group_disagreement_votes v
  WHERE v.group_id = p_group_id AND v.day = p_day
  GROUP BY v.voted_for;
$$;

-- Server-only, like the rest of the group stats.
REVOKE EXECUTE ON FUNCTION
  group_feed(uuid, uuid, text, uuid, uuid),
  group_daily_disagreement(uuid, date, uuid, uuid),
  group_disagreement_tally(uuid, date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  group_feed(uuid, uuid, text, uuid, uuid),
  group_daily_disagreement(uuid, date, uuid, uuid),
  group_disagreement_tally(uuid, date)
TO service_role;
