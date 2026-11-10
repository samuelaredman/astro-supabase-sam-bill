-- Phase 3 Slice 1 — exclude non-rankable igdb_category rows from rankings/hubs.
--
-- Until now the ranking and hub RPCs read from game_review_stats with zero
-- category filter. That was safe only because non-base game rows had zero
-- published reviews (DLC-addons, ports, bundles, etc. were never reviewable
-- from the UI). Phase 3 opens DLC reviews, so these RPCs must pre-filter the
-- result set — otherwise popular DLCs could push base games out of the top-N
-- that the page then post-filters with ALLOWED_GAME_CATEGORIES (src/utils/
-- games.ts), leaving gaps instead of ranked content.
--
-- Filter policy: exclude categories that are NOT substantive standalone
-- content. Matches ALLOWED_GAME_CATEGORIES exactly.
--   Excluded: 1 dlc_addon, 3 bundle, 5 mod, 6 episode, 7 season, 11 port,
--             12 fork, 13 pack, 14 update
--   Included: 0 main_game, NULL legacy, 2 expansion, 4 standalone_expansion,
--             8 remake, 9 remaster, 10 expanded_game
--
-- This migration is INTENTIONALLY A NO-OP ON PRODUCTION DATA TODAY — no
-- excluded-category row has published reviews yet. The filter protects us the
-- moment Slice 3 (write-review DLC composer) lands and users start publishing
-- reviews on expansions and DLC-addons. The before/after snapshots during
-- smoke testing must be byte-identical.
--
-- Feed/hot-takes/hub descriptive stats (group_review_summary, group_hot_take,
-- home_hot_takes, home_trending_games, etc.) are DELIBERATELY unchanged —
-- feeds show every DLC review per the locked design (differentiated by the
-- Phase 3 Slice 2 ReviewCard badge).
--
-- All functions keep CREATE OR REPLACE semantics — signature-compatible with
-- existing callers. New profile_review_type_counts added for Slice 4.

-- ── ranked_games (Rankings page: Bayesian top-N) ──────────────────────────────
CREATE OR REPLACE FUNCTION ranked_games(
  p_limit        int DEFAULT 100,
  p_min_reviews  int DEFAULT 2,
  p_prior_weight int DEFAULT 5
)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8, bayesian_score float8)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM game_review_stats),
  m AS (
    SELECT coalesce(sum(score_sum)::float8 / nullif(sum(review_count), 0), 7) AS mean FROM s
  )
  SELECT
    s.game_id,
    s.review_count,
    s.avg_score,
    (p_prior_weight * m.mean + s.score_sum) / (p_prior_weight + s.review_count) AS bayesian_score
  FROM s CROSS JOIN m
  WHERE s.review_count >= p_min_reviews
    AND EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = s.game_id
        AND (g.igdb_category IS NULL OR g.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14))
    )
  ORDER BY bayesian_score DESC, s.game_id
  LIMIT p_limit;
$$;

-- ── most_reviewed_games (/search browse grid + /discover fallback) ────────────
CREATE OR REPLACE FUNCTION most_reviewed_games(
  p_limit              int  DEFAULT 48,
  p_genre_id           uuid DEFAULT NULL,
  p_platform_id        uuid DEFAULT NULL,
  p_exclude_profile_id uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, review_count int, avg_score float8)
LANGUAGE sql STABLE AS $$
  SELECT s.game_id, s.review_count, s.avg_score
  FROM game_review_stats s
  WHERE EXISTS (
          SELECT 1 FROM games g
          WHERE g.id = s.game_id
            AND (g.igdb_category IS NULL OR g.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14))
        )
    AND (p_genre_id IS NULL OR EXISTS (
          SELECT 1 FROM game_genres gg WHERE gg.game_id = s.game_id AND gg.genre_id = p_genre_id))
    AND (p_platform_id IS NULL OR EXISTS (
          SELECT 1 FROM game_platforms gp WHERE gp.game_id = s.game_id AND gp.platform_id = p_platform_id))
    AND (p_exclude_profile_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.game_id = s.game_id AND r.profile_id = p_exclude_profile_id AND r.status = 'published'))
  ORDER BY s.review_count DESC, s.game_id
  LIMIT p_limit;
$$;

-- ── top_studios_by_reviewed_games (/search studio tab) ────────────────────────
CREATE OR REPLACE FUNCTION top_studios_by_reviewed_games(p_limit int DEFAULT 24)
RETURNS TABLE(id uuid, name text, slug text, reviewed_game_count int)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.name, d.slug, count(*)::int AS reviewed_game_count
  FROM game_review_stats s
  JOIN games g ON g.id = s.game_id
  JOIN game_companies gc ON gc.game_id = s.game_id AND gc.role = 'developer'
  JOIN developers d ON d.id = gc.company_id
  WHERE g.igdb_category IS NULL OR g.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14)
  GROUP BY d.id, d.name, d.slug
  ORDER BY reviewed_game_count DESC, d.name
  LIMIT p_limit;
$$;

-- ── hub_game_review_stats (/genres/* /platforms/* /studios/*) ─────────────────
CREATE OR REPLACE FUNCTION hub_game_review_stats(
  p_genre_id    uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL,
  p_company_id  uuid DEFAULT NULL
)
RETURNS TABLE(game_id uuid, review_count int, score_sum int)
LANGUAGE sql STABLE AS $$
  SELECT s.game_id, s.review_count, s.score_sum
  FROM game_review_stats s
  WHERE EXISTS (
          SELECT 1 FROM games g
          WHERE g.id = s.game_id
            AND (g.igdb_category IS NULL OR g.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14))
        )
    AND (p_genre_id IS NULL OR EXISTS (
          SELECT 1 FROM game_genres x WHERE x.game_id = s.game_id AND x.genre_id = p_genre_id))
    AND (p_platform_id IS NULL OR EXISTS (
          SELECT 1 FROM game_platforms x WHERE x.game_id = s.game_id AND x.platform_id = p_platform_id))
    AND (p_company_id IS NULL OR EXISTS (
          SELECT 1 FROM game_companies x WHERE x.game_id = s.game_id AND x.company_id = p_company_id));
$$;

-- ── game_rank_stats (per-game page: #N all-time / genre / year) ───────────────
-- Ranking pool must match the categories above, otherwise a cat=0 base game
-- could be out-ranked by a hidden DLC-addon's avg score and show a wrong rank.
CREATE OR REPLACE FUNCTION game_rank_stats(
  p_game_id      uuid,
  p_genre_id     uuid,
  p_release_year int
)
RETURNS TABLE(
  all_time_rank   int,
  all_time_total  int,
  genre_rank      int,
  genre_total     int,
  genre_avg_score float8,
  year_rank       int,
  year_total      int
) LANGUAGE sql STABLE AS $$
  WITH this AS (
    SELECT coalesce(
      (SELECT avg_score FROM game_review_stats WHERE game_id = p_game_id), 0
    ) AS avg
  ),
  s AS (
    SELECT
      st.avg_score,
      st.review_count,
      st.score_sum,
      gg.game_id IS NOT NULL AS in_genre,
      gy.id IS NOT NULL AS in_year
    FROM game_review_stats st
    JOIN games gc
      ON gc.id = st.game_id
     AND (gc.igdb_category IS NULL OR gc.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14))
    LEFT JOIN game_genres gg
      ON gg.game_id = st.game_id AND gg.genre_id = p_genre_id
    LEFT JOIN games gy
      ON gy.id = st.game_id AND extract(year FROM gy.date_released) = p_release_year
  )
  SELECT
    CASE WHEN count(*) FILTER (WHERE s.avg_score <= this.avg) > 0
         THEN (count(*) FILTER (WHERE s.avg_score > this.avg) + 1)::int
         ELSE 0 END,
    count(*)::int,
    CASE WHEN p_genre_id IS NULL THEN 0
         ELSE (count(*) FILTER (WHERE s.in_genre AND s.avg_score > this.avg) + 1)::int END,
    count(*) FILTER (WHERE s.in_genre)::int,
    coalesce(round(
      sum(s.score_sum) FILTER (WHERE s.in_genre)::numeric
        / nullif(sum(s.review_count) FILTER (WHERE s.in_genre), 0),
      1), 0)::float8,
    CASE WHEN p_release_year IS NULL THEN 0
         ELSE (count(*) FILTER (WHERE s.in_year AND s.avg_score > this.avg) + 1)::int END,
    count(*) FILTER (WHERE s.in_year)::int
  FROM s CROSS JOIN this
  GROUP BY this.avg;
$$;

-- ── group_game_review_stats (group top-games / top-rated leaderboards) ────────
-- Group leaderboards must not be gameable by DLC-addon reviews either. Group
-- *descriptive* functions (group_review_summary, group_member_review_stats,
-- group_split_decision, group_hot_take) intentionally stay inclusive — those
-- are feed-like, not rankings.
CREATE OR REPLACE FUNCTION group_game_review_stats(
  p_group_id uuid,
  p_genre_id uuid DEFAULT NULL,
  p_platform_id uuid DEFAULT NULL
)
RETURNS TABLE(
  game_id uuid, title text, slug text, cover_img_url text,
  review_count int, avg_score float8, min_score int, max_score int
)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.title, g.slug, g.cover_img_url,
         s.review_count, s.avg_score, s.min_score, s.max_score
  FROM (
    SELECT game_id,
           count(*)::int AS review_count,
           avg(score)::float8 AS avg_score,
           min(score) AS min_score,
           max(score) AS max_score
    FROM group_reviews(p_group_id, p_genre_id, p_platform_id)
    GROUP BY game_id
  ) s
  JOIN games g
    ON g.id = s.game_id
   AND (g.igdb_category IS NULL OR g.igdb_category NOT IN (1, 3, 5, 6, 7, 11, 12, 13, 14));
$$;

-- Re-grant service-role execute on the redefined group function (CREATE OR
-- REPLACE preserves grants in modern Postgres, but belt-and-suspenders).
REVOKE EXECUTE ON FUNCTION group_game_review_stats(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION group_game_review_stats(uuid, uuid, uuid)
  TO service_role;

-- ── profile_review_type_counts (NEW — Slice 4 profile subtitle) ───────────────
-- Returns the breakdown that drives the "N reviews · N games · N DLC" line on
-- reviewer profiles. Buckets match reviewable categories; DLC subtitle count
-- is computed client-side as expansions + dlc_addons.
--   games:       cat NULL/0 (base), 8 (remake), 9 (remaster), 10 (expanded_game)
--   expansions:  cat 2 (expansion), 4 (standalone_expansion)
--   dlc_addons:  cat 1 (DLC add-on)
-- total == games + expansions + dlc_addons for every current reviewable row.
-- If a legacy review points at a non-reviewable category row somehow, total
-- stays authoritative and the bucket columns under-report — intentionally.
CREATE OR REPLACE FUNCTION profile_review_type_counts(p_profile_id uuid)
RETURNS TABLE(total int, games int, expansions int, dlc_addons int)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*)::int AS total,
    count(*) FILTER (
      WHERE g.igdb_category IS NULL OR g.igdb_category IN (0, 8, 9, 10)
    )::int AS games,
    count(*) FILTER (WHERE g.igdb_category IN (2, 4))::int AS expansions,
    count(*) FILTER (WHERE g.igdb_category = 1)::int AS dlc_addons
  FROM reviews r
  JOIN games g ON g.id = r.game_id
  WHERE r.profile_id = p_profile_id AND r.status = 'published';
$$;

-- Server-only, matching the other stat functions (pages use service-role).
REVOKE EXECUTE ON FUNCTION profile_review_type_counts(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION profile_review_type_counts(uuid)
  TO service_role;
