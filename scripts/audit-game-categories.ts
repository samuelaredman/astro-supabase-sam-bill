/**
 * Read-only audit of game data cleanliness. Reports:
 *   1. Breakdown of all games by igdb_category (including unbackfilled/null).
 *   2. "Noise"-category games (outside ALLOWED_CATEGORIES, kept in sync with
 *      src/pages/api/games/search.ts) with review/watchlist engagement counts,
 *      so we know what's safe to remove vs needs a manual call.
 *   3. Games sharing an exact normalized title — candidate duplicates or
 *      remake/remaster/port clusters.
 *
 * Run: npx tsx scripts/audit-game-categories.ts
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
 * Makes no writes.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const PAGE_SIZE = 1000;

const CATEGORY_NAMES: Record<number, string> = {
  0: 'main_game', 1: 'dlc_addon', 2: 'expansion', 3: 'bundle',
  4: 'standalone_expansion', 5: 'mod', 6: 'episode', 7: 'season',
  8: 'remake', 9: 'remaster', 10: 'expanded_game', 11: 'port',
  12: 'fork', 13: 'pack', 14: 'update',
};

// Kept in sync with ALLOWED_CATEGORIES in src/pages/api/games/search.ts
const ALLOWED_CATEGORIES = [0, 2, 4, 8, 9, 10];

async function fetchAllPaginated<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = [];
  let page = 0;
  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

type GameRow = {
  id: string;
  title: string;
  slug: string | null;
  igdb_id: number | null;
  igdb_category: number | null;
  date_released: string | null;
};

async function main() {
  console.log('Fetching all games...\n');

  const games = await fetchAllPaginated<GameRow>((from, to) =>
    db.from('games')
      .select('id, title, slug, igdb_id, igdb_category, date_released')
      .order('id')
      .range(from, to)
  );

  console.log(`Total games: ${games.length}\n`);

  // ── 1. Category breakdown ────────────────────────────────────────────────
  const byCategory = new Map<string, number>();
  for (const g of games) {
    const key = g.igdb_category === null
      ? 'null (unbackfilled)'
      : `${g.igdb_category} (${CATEGORY_NAMES[g.igdb_category] ?? 'unknown'})`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  console.log('── Category breakdown ──');
  for (const [key, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  // ── 2. Noise-category games + engagement ─────────────────────────────────
  const noiseGames = games.filter(
    g => g.igdb_category !== null && !ALLOWED_CATEGORIES.includes(g.igdb_category)
  );
  console.log(`\n── Noise-category games: ${noiseGames.length} ──`);

  if (noiseGames.length > 0) {
    const noiseIds = noiseGames.map(g => g.id);
    const ID_CHUNK = 200; // stay under PostgREST's URL length limit for large .in() lists
    const idChunks: string[][] = [];
    for (let i = 0; i < noiseIds.length; i += ID_CHUNK) idChunks.push(noiseIds.slice(i, i + ID_CHUNK));

    async function fetchEngagement(table: string): Promise<{ game_id: string }[]> {
      const rows: { game_id: string }[] = [];
      for (const chunk of idChunks) {
        const chunkRows = await fetchAllPaginated<{ game_id: string }>((from, to) =>
          db.from(table).select('game_id').in('game_id', chunk).range(from, to));
        rows.push(...chunkRows);
      }
      return rows;
    }

    const [reviews, watchlist, groupWatchlist] = await Promise.all([
      fetchEngagement('reviews'),
      fetchEngagement('watchlist'),
      fetchEngagement('group_watchlist'),
    ]);

    const reviewCounts = new Map<string, number>();
    for (const r of reviews) reviewCounts.set(r.game_id, (reviewCounts.get(r.game_id) ?? 0) + 1);
    const watchlistCounts = new Map<string, number>();
    for (const w of watchlist) watchlistCounts.set(w.game_id, (watchlistCounts.get(w.game_id) ?? 0) + 1);
    const groupWatchlistCounts = new Map<string, number>();
    for (const gw of groupWatchlist) groupWatchlistCounts.set(gw.game_id, (groupWatchlistCounts.get(gw.game_id) ?? 0) + 1);

    let safeToRemove = 0;
    let needsReview = 0;

    for (const g of [...noiseGames].sort((a, b) => a.title.localeCompare(b.title))) {
      const rc = reviewCounts.get(g.id) ?? 0;
      const wc = watchlistCounts.get(g.id) ?? 0;
      const gwc = groupWatchlistCounts.get(g.id) ?? 0;
      const hasEngagement = rc > 0 || wc > 0 || gwc > 0;
      if (hasEngagement) needsReview++; else safeToRemove++;
      const catName = CATEGORY_NAMES[g.igdb_category!] ?? 'unknown';
      console.log(
        `  [${catName}] "${g.title}" (${g.slug ?? 'no-slug'}) — reviews:${rc} watchlist:${wc} group_watchlist:${gwc}${hasEngagement ? '  ⚠ HAS ENGAGEMENT' : ''}`
      );
    }

    console.log(`\n  Safe to remove (zero engagement): ${safeToRemove}`);
    console.log(`  Needs manual review (has engagement): ${needsReview}`);
  }

  // ── 3. Duplicate title clusters ───────────────────────────────────────────
  const byTitle = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = g.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push(g);
  }
  const dupClusters = [...byTitle.entries()].filter(([, rows]) => rows.length > 1);

  console.log(`\n── Exact-title duplicate clusters: ${dupClusters.length} ──`);
  for (const [title, rows] of dupClusters.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${title}" (${rows.length}x):`);
    for (const r of rows) {
      const catName = r.igdb_category === null ? 'null' : (CATEGORY_NAMES[r.igdb_category] ?? 'unknown');
      console.log(`    - ${r.id}  [${catName}]  slug:${r.slug ?? 'none'}  igdb_id:${r.igdb_id ?? 'none'}  released:${r.date_released ?? 'unknown'}`);
    }
  }

  console.log('\nDone. This was a read-only audit — no data was changed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
