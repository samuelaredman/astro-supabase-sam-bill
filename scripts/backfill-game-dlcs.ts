/**
 * One-shot backfill: for every canonical game already in our catalog, walk its
 * IGDB reverse-relationship arrays (dlcs, expansions, standalone_expansions,
 * expanded_games, remakes), pull any missing child games into the DB, and
 * persist the parent↔child edges in game_relationships.
 *
 * Fixes the historical case where a game (e.g. Blasphemous) was imported before
 * game_relationships existed, or before its DLCs were ever searched for — the
 * DLC & Editions tab shows nothing until those child rows and edges exist.
 *
 * Fully idempotent: games already in the catalog are skipped, and edge upserts
 * use ignoreDuplicates.
 *
 * Run from project root:
 *   npx tsx scripts/backfill-game-dlcs.ts --dry-run              # preview counts only
 *   npx tsx scripts/backfill-game-dlcs.ts --limit 50             # try on first 50 bases
 *   npx tsx scripts/backfill-game-dlcs.ts                        # full run
 *
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IGDB_CLIENT_ID,
 * IGDB_CLIENT_SECRET in your .env file.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { asIgdbId, importMissingChildrenFromIgdb } from '../src/utils/games';

const IGDB_URL = 'https://api.igdb.com/v4';
const BATCH_SIZE = 500;           // games per IGDB `where id = (...)` call
const SLEEP_BETWEEN_BATCHES_MS = 300;

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.slice('--limit='.length), 10)) : Infinity;

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getIgdbToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  const data = await res.json() as any;
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken!;
}

async function igdbFetch(query: string): Promise<any[]> {
  const token = await getIgdbToken();
  const res = await fetch(`${IGDB_URL}/games`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID!,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });
  if (!res.ok) {
    console.error('  IGDB error:', res.status, await res.text());
    return [];
  }
  return res.json();
}

async function main() {
  console.log(`DLC backfill — ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writing)'}${Number.isFinite(LIMIT) ? ` [limit=${LIMIT}]` : ''}\n`);

  // Walk canonical games only — collapsed editions share the base's DLCs and
  // get them via the base, not their own rows.
  const bases: Array<{ id: string; igdb_id: number; title: string }> = [];
  const PAGE_SIZE = 1000;
  let page = 0;
  while (bases.length < LIMIT) {
    const { data, error } = await db
      .from('games')
      .select('id, igdb_id, title')
      .is('canonical_game_id', null)
      .not('igdb_id', 'is', null)
      .order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      console.error('Failed to fetch bases:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    bases.push(...(data as any[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  const scope = bases.slice(0, Number.isFinite(LIMIT) ? LIMIT : bases.length);
  console.log(`Loaded ${scope.length} canonical bases.\n`);

  let seenChildrenTotal = 0;
  let missingChildrenTotal = 0;
  let insertedChildrenTotal = 0;
  let basesWithChildren = 0;

  const totalBatches = Math.ceil(scope.length / BATCH_SIZE);
  for (let i = 0; i < scope.length; i += BATCH_SIZE) {
    const batch = scope.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} bases)... `);

    // One IGDB call for the whole batch — we only need the five reverse
    // relationship arrays to know what the children are. The eager-import
    // helper fetches each child's full metadata in its own batched call.
    const igdbGames = await igdbFetch(`
      fields id, dlcs, expansions, standalone_expansions, expanded_games, remakes;
      where id = (${batch.map((g) => g.igdb_id).join(',')});
      limit ${batch.length};
    `);

    const igdbByIgdbId = new Map<number, any>(igdbGames.map((g) => [g.id, g]));

    for (const base of batch) {
      const igdbData = igdbByIgdbId.get(base.igdb_id);
      if (!igdbData) continue;

      const childIgdbIds = new Set<number>();
      for (const field of ['dlcs', 'expansions', 'standalone_expansions', 'expanded_games', 'remakes']) {
        for (const raw of igdbData?.[field] ?? []) {
          const id = asIgdbId(raw);
          if (id != null) childIgdbIds.add(id);
        }
      }
      if (childIgdbIds.size === 0) continue;

      basesWithChildren++;
      seenChildrenTotal += childIgdbIds.size;

      if (DRY_RUN) {
        // Count how many of those children would need importing (not in DB).
        const ids = [...childIgdbIds];
        const existing = new Set<number>();
        for (let j = 0; j < ids.length; j += 100) {
          const slice = ids.slice(j, j + 100);
          const { data: rows } = await db.from('games').select('igdb_id').in('igdb_id', slice);
          for (const r of (rows ?? []) as any[]) existing.add(r.igdb_id);
        }
        missingChildrenTotal += ids.length - existing.size;
        continue;
      }

      try {
        const { attempted, inserted } = await importMissingChildrenFromIgdb(db as any, igdbData);
        missingChildrenTotal += attempted;
        insertedChildrenTotal += inserted;
      } catch (e) {
        console.error(`\n  "${base.title}" (igdb_id ${base.igdb_id}) failed:`, e);
      }
    }

    console.log(`done`);

    if (i + BATCH_SIZE < scope.length) {
      await new Promise((r) => setTimeout(r, SLEEP_BETWEEN_BATCHES_MS));
    }
  }

  console.log('\n── Summary ──');
  console.log(`  Bases walked:                ${scope.length}`);
  console.log(`  Bases with ≥1 child:         ${basesWithChildren}`);
  console.log(`  Total child relationships:   ${seenChildrenTotal}`);
  console.log(`  Child rows ${DRY_RUN ? 'needing import' : 'attempted'}: ${missingChildrenTotal}`);
  if (!DRY_RUN) console.log(`  Child rows inserted:         ${insertedChildrenTotal}`);
  console.log(DRY_RUN ? '\nDry run — re-run without --dry-run to apply.' : '\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
