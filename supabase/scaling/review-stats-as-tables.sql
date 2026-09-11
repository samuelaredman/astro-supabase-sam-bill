-- NOT A MIGRATION — apply when needed, as a new migration file.
--
-- Swaps the aggregate views game_review_stats and profile_review_stats for
-- tables of the same name and columns, kept current by a trigger on reviews.
-- Every review-stats function reads through those two names, so no function
-- and no page changes; reads go from O(all published reviews) to a scan of the
-- (much smaller) stats rows or a primary-key lookup.
--
-- When: once the stats functions show up in query timings. Benchmarked on
-- PGlite (single-threaded Postgres-in-WASM, so upper bounds), the view-based
-- functions took ~10 ms at 10k published reviews, ~50–130 ms at 100k and
-- ~350–600 ms at 1M. Somewhere past ~100k reviews is the time.
--
-- Concurrency: the trigger applies +1/-1 deltas with an upsert, so two writes
-- to the same game serialize on its stats row and both count. (Recomputing the
-- game's aggregate instead would race: each transaction can miss the other's
-- uncommitted review.)
--
-- Verified in PGlite: identical function results before and after the swap,
-- and the tables stay equal to a fresh aggregate through random inserts,
-- status flips, score / play-time / game changes and deletes.

BEGIN;

-- Block review writes until the backfill below is committed, so none land
-- between the backfill and the trigger taking over.
LOCK TABLE reviews IN SHARE ROW EXCLUSIVE MODE;

DROP VIEW game_review_stats;
CREATE TABLE game_review_stats (
  game_id      uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  review_count int  NOT NULL,
  score_sum    int  NOT NULL,
  avg_score    float8 GENERATED ALWAYS AS (score_sum::float8 / NULLIF(review_count, 0)) STORED,
  hours_count  int  NOT NULL,
  hours_sum    int  NOT NULL
);

DROP VIEW profile_review_stats;
CREATE TABLE profile_review_stats (
  profile_id   uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  review_count int  NOT NULL
);

INSERT INTO game_review_stats (game_id, review_count, score_sum, hours_count, hours_sum)
SELECT game_id, count(*), sum(score),
       count(*) FILTER (WHERE play_time_hours > 0),
       coalesce(sum(play_time_hours) FILTER (WHERE play_time_hours > 0), 0)
FROM reviews WHERE status = 'published' GROUP BY game_id;

INSERT INTO profile_review_stats (profile_id, review_count)
SELECT profile_id, count(*) FROM reviews WHERE status = 'published' GROUP BY profile_id;

-- Add (p_sign = 1) or remove (p_sign = -1) one published review's contribution.
-- Rows at zero are deleted: "one row per reviewed game / reviewer" is part of
-- the contract (ranks and totals count rows).
CREATE FUNCTION apply_review_stats_delta(
  p_game_id uuid, p_profile_id uuid, p_sign int, p_score int, p_hours int
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO game_review_stats AS s (game_id, review_count, score_sum, hours_count, hours_sum)
  VALUES (p_game_id, p_sign, p_sign * p_score,
          CASE WHEN p_hours > 0 THEN p_sign ELSE 0 END,
          CASE WHEN p_hours > 0 THEN p_sign * p_hours ELSE 0 END)
  ON CONFLICT (game_id) DO UPDATE SET
    review_count = s.review_count + EXCLUDED.review_count,
    score_sum    = s.score_sum    + EXCLUDED.score_sum,
    hours_count  = s.hours_count  + EXCLUDED.hours_count,
    hours_sum    = s.hours_sum    + EXCLUDED.hours_sum;
  DELETE FROM game_review_stats WHERE game_id = p_game_id AND review_count <= 0;

  INSERT INTO profile_review_stats AS p (profile_id, review_count)
  VALUES (p_profile_id, p_sign)
  ON CONFLICT (profile_id) DO UPDATE SET review_count = p.review_count + EXCLUDED.review_count;
  DELETE FROM profile_review_stats WHERE profile_id = p_profile_id AND review_count <= 0;
$$;

-- SECURITY DEFINER: whoever writes a review (service role today, possibly an
-- RLS-bound user client later) must not need write access to the stats tables.
CREATE FUNCTION reviews_maintain_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Edits that can't move any stat (title, body, spoiler flag, …) do nothing.
  IF TG_OP = 'UPDATE'
     AND OLD.status = NEW.status AND OLD.score = NEW.score
     AND OLD.game_id = NEW.game_id AND OLD.profile_id = NEW.profile_id
     AND OLD.play_time_hours IS NOT DISTINCT FROM NEW.play_time_hours THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'published' THEN
    PERFORM apply_review_stats_delta(OLD.game_id, OLD.profile_id, -1, OLD.score, OLD.play_time_hours);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'published' THEN
    PERFORM apply_review_stats_delta(NEW.game_id, NEW.profile_id, 1, NEW.score, NEW.play_time_hours);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER reviews_maintain_stats
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION reviews_maintain_stats();

-- Server-only, like the views they replace (see 20260911000005).
ALTER TABLE game_review_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_review_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_review_stats, profile_review_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON game_review_stats, profile_review_stats TO service_role;
REVOKE EXECUTE ON FUNCTION apply_review_stats_delta(uuid, uuid, int, int, int), reviews_maintain_stats()
  FROM PUBLIC, anon, authenticated;

COMMIT;
