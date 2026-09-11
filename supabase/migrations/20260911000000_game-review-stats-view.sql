-- Per-game aggregates over published reviews — the single source every
-- site-wide or hub-wide review stat reads from (rankings, discover, search
-- browse + studio ranking, the game page's ranks, genre/platform/studio hubs,
-- a profile's community averages). The functions in the next migrations sit on
-- top of it and return only the rows a page actually displays.
--
-- Why: pages pulled individual review rows and aggregated them in JS. That
-- ships O(all reviews) over the wire on every render, and it silently breaks
-- past Supabase's 1000-row response cap — rankings.astro and discover.astro
-- read the whole table unpaged, search.astro's studio tab read all of
-- game_companies (already > 1000 rows), and the hub pages sent 500–1000 game
-- ids in a single `.in()` URL (the PS5 platform page shows "0 reviews").
--
-- Scaling: a plain view aggregates on read, which costs nothing at hundreds or
-- low thousands of reviews. Once it shows up in query timings (tens of
-- thousands of reviews), replace it with a table of the same name and columns
-- kept current by a trigger on reviews, or a materialized view refreshed on a
-- schedule. Every caller reads through this interface, so none of them change.
--
-- security_invoker: evaluated with the caller's privileges, so reviews' RLS
-- still applies to anon callers (who can only see published rows anyway).

CREATE OR REPLACE VIEW game_review_stats WITH (security_invoker = true) AS
SELECT
  game_id,
  count(*)::int                                               AS review_count,
  sum(score)::int                                             AS score_sum,
  -- float8, not numeric: the same arithmetic the JS it replaces did.
  sum(score)::float8 / count(*)                               AS avg_score,
  -- Play time only counts where a reviewer logged some.
  count(*) FILTER (WHERE play_time_hours > 0)::int            AS hours_count,
  coalesce(sum(play_time_hours) FILTER (WHERE play_time_hours > 0), 0)::int AS hours_sum
FROM reviews
WHERE status = 'published'
GROUP BY game_id;
