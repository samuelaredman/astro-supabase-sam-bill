/**
 * One-time backfill: populates igdb_category, igdb_status, storyline,
 * and the new junction tables (themes, game_modes, franchises, collections)
 * for all games that already have an igdb_id.
 *
 * Run from project root:
 *   npx tsx scripts/backfill-game-metadata.ts
 *
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * IGDB_CLIENT_ID, IGDB_CLIENT_SECRET in your .env file.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const IGDB_URL = 'https://api.igdb.com/v4';
const BATCH_SIZE = 500;

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── IGDB auth ─────────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getIgdbToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
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

// ── Batch junction upsert ─────────────────────────────────────────────────────
// Processes a whole batch at once: 3 DB ops per entity type instead of N per game.

async function upsertJunctionBatch(
  gameDataMap: Map<string, any>,
  igdbField: string,
  refTable: string,
  junctionTable: string,
  junctionCol: string
): Promise<void> {
  const allItems = new Map<number, { id: number; name: string; slug?: string }>();
  for (const igdbGame of gameDataMap.values()) {
    for (const item of (igdbGame[igdbField] ?? [])) {
      allItems.set(item.id, item);
    }
  }
  if (allItems.size === 0) return;

  // 1. Upsert all ref-table rows
  const refRows = Array.from(allItems.values()).map(item => ({
    igdb_id: item.id,
    name: item.name,
    slug: item.slug ?? null,
  }));
  await (db as any).from(refTable).upsert(refRows, { onConflict: 'igdb_id' });

  // 2. Fetch their internal UUIDs
  const { data: refData } = await (db as any)
    .from(refTable)
    .select('id, igdb_id')
    .in('igdb_id', Array.from(allItems.keys()));
  if (!refData?.length) return;

  const igdbToUuid = new Map<number, string>(refData.map((r: any) => [r.igdb_id, r.id]));

  // 3. Build and bulk-upsert all junction rows
  const junctionRows: any[] = [];
  for (const [gameUuid, igdbGame] of gameDataMap.entries()) {
    for (const item of (igdbGame[igdbField] ?? [])) {
      const refUuid = igdbToUuid.get(item.id);
      if (refUuid) junctionRows.push({ game_id: gameUuid, [junctionCol]: refUuid });
    }
  }
  if (junctionRows.length > 0) {
    await (db as any).from(junctionTable).upsert(junctionRows, {
      onConflict: `game_id,${junctionCol}`,
      ignoreDuplicates: true,
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { data: allGames, error } = await db
    .from('games')
    .select('id, igdb_id, title')
    .not('igdb_id', 'is', null)
    .order('id');

  if (error || !allGames) {
    console.error('Failed to fetch games from DB:', error);
    process.exit(1);
  }

  const total = allGames.length;
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  console.log(`Backfilling ${total} games in ${totalBatches} batches...\n`);

  let processed = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = allGames.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} games)... `);

    const igdbGames = await igdbFetch(`
      fields id, category, status, storyline,
             themes.id, themes.name, themes.slug,
             game_modes.id, game_modes.name, game_modes.slug,
             franchises.id, franchises.name, franchises.slug,
             collections.id, collections.name, collections.slug;
      where id = (${batch.map(g => g.igdb_id).join(',')});
      limit ${BATCH_SIZE};
    `);

    const igdbByIgdbId = new Map<number, any>(igdbGames.map(g => [g.id, g]));

    const gameDataMap = new Map<string, any>();
    const scalarUpdates: any[] = [];

    for (const game of batch) {
      const igdbData = igdbByIgdbId.get(game.igdb_id);
      if (!igdbData) continue;
      gameDataMap.set(game.id, igdbData);
      scalarUpdates.push({
        id:            game.id,
        igdb_category: igdbData.category  ?? null,
        igdb_status:   igdbData.status    ?? null,
        storyline:     igdbData.storyline ?? null,
      });
    }

    // Bulk update scalar fields
    if (scalarUpdates.length > 0) {
      const { error: updateError } = await db
        .from('games')
        .upsert(scalarUpdates, { onConflict: 'id' });
      if (updateError) console.error('\n  Scalar update error:', updateError.message);
    }

    // Batch upsert all junction tables in parallel
    await Promise.all([
      upsertJunctionBatch(gameDataMap, 'themes',     'themes',     'game_themes',     'theme_id'),
      upsertJunctionBatch(gameDataMap, 'game_modes', 'game_modes', 'game_game_modes', 'game_mode_id'),
      upsertJunctionBatch(gameDataMap, 'franchises', 'franchises', 'game_franchises', 'franchise_id'),
      upsertJunctionBatch(gameDataMap, 'collections','collections','game_collections','collection_id'),
    ]);

    processed += batch.length;
    console.log(`done — ${processed}/${total}`);

    // Stay under IGDB's 4 req/sec limit between batches
    if (i + BATCH_SIZE < total) await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nBackfill complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
