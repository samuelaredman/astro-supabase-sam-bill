import { getSupabaseAdmin } from './database';
import { GAME_CATEGORY_OR_FILTER } from './games';

/**
 * Homepage vanity counters ("1.2k reviews", "8.4k games", …).
 *
 * Each of these is a `count: 'exact'` over a whole table — the `games` one runs
 * a multi-branch OR filter that can't use an index — and the homepage is
 * `Cache-Control: no-store` for logged-in users, so without this every
 * authenticated reload re-ran four full-table counts before rendering.
 *
 * These numbers only need to be roughly right and only move slowly, so compute
 * them at most once per TTL per warm server instance and serve the last value
 * immediately while a stale one refreshes in the background.
 */
export interface SiteStats {
  totalReviews: number;
  totalRecommendations: number;
  totalGames: number;
  totalReviewers: number;
}

const TTL_MS = 5 * 60 * 1000;

let cached: { at: number; value: SiteStats } | null = null;
let inFlight: Promise<SiteStats> | null = null;

async function computeSiteStats(): Promise<SiteStats> {
  const db = getSupabaseAdmin() as any;
  const [reviews, recs, games, profiles] = await Promise.all([
    db.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    db.from('recommendations').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    // `estimated` = planner row estimate for big tables; the exact scan here was
    // the slowest of the four and the displayed number is bucketed anyway.
    db.from('games').select('*', { count: 'estimated', head: true }).or(GAME_CATEGORY_OR_FILTER),
    db.from('profiles').select('*', { count: 'estimated', head: true }),
  ]);

  const value: SiteStats = {
    totalReviews: reviews.count ?? cached?.value.totalReviews ?? 0,
    totalRecommendations: recs.count ?? cached?.value.totalRecommendations ?? 0,
    totalGames: games.count ?? cached?.value.totalGames ?? 0,
    totalReviewers: profiles.count ?? cached?.value.totalReviewers ?? 0,
  };

  if (!reviews.error && !recs.error && !games.error && !profiles.error) {
    cached = { at: Date.now(), value };
    return value;
  }
  // Partial failure — keep serving the previous good value if we have one.
  return cached?.value ?? value;
}

export async function getSiteStats(): Promise<SiteStats> {
  const isFresh = cached && Date.now() - cached.at < TTL_MS;
  if (isFresh) return cached!.value;

  if (!inFlight) {
    inFlight = computeSiteStats().finally(() => { inFlight = null; });
  }
  // Stale-while-revalidate: only the very first call ever blocks on the counts.
  if (cached) return cached.value;
  return inFlight;
}
