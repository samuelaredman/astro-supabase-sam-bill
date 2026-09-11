/**
 * Review stats for the genre / platform / studio hub pages.
 *
 * The hubs get one row per reviewed game from hub_game_review_stats() (see
 * supabase/migrations/20260911000004) — a review count and score sum, not the
 * individual scores — so every average here is sum / count, which is exactly
 * what averaging the individual scores gave.
 */

export type HubStats = Record<string, { count: number; sum: number }>;

/** One row of hub_game_review_stats(). */
export type HubStatRow = { game_id: string; review_count: number; score_sum: number };

/** Index the RPC rows by game, keeping only the games the page displays. */
export function hubStatsFor(
  rows: HubStatRow[] | null | undefined,
  gameIds: Iterable<string>,
): HubStats {
  const keep = new Set(gameIds);
  const stats: HubStats = {};
  for (const r of rows ?? []) {
    if (keep.has(r.game_id)) stats[r.game_id] = { count: r.review_count, sum: r.score_sum };
  }
  return stats;
}

export function reviewCount(stats: HubStats, gameId: string): number {
  return stats[gameId]?.count ?? 0;
}

/** A game's average score to one decimal, or null when it has no reviews. */
export function avgScore(stats: HubStats, gameId: string): string | null {
  const s = stats[gameId];
  return s && s.count > 0 ? (s.sum / s.count).toFixed(1) : null;
}

/** Review-weighted totals across the given games (every game in `stats` by default). */
export function pooled(stats: HubStats, gameIds: Iterable<string> = Object.keys(stats)): { count: number; sum: number } {
  let count = 0, sum = 0;
  for (const id of gameIds) {
    const s = stats[id];
    if (s) { count += s.count; sum += s.sum; }
  }
  return { count, sum };
}
