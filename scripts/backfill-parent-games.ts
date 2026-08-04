/**
 * One-time backfill: populates games.parent_game_id from IGDB's parent_game /
 * version_parent fields, linking DLC, expansions, and alternate editions to their
 * base game (e.g. Phantom Liberty -> Cyberpunk 2077).
 *
 * "Link existing only": a parent link is written only when the base game is ALREADY
 * in our DB. Missing parents are not imported here — that's a separate pass.
 *
 * Run from project root:
 *   npx tsx scripts/backfill-parent-games.ts
 *
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * IGDB_CLIENT_ID, IGDB_CLIENT_SECRET in your .env file.
 *
 * Apply the 20260717000000_game-parent-linking migration BEFORE running this.
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load every game with an igdb_id, building an igdb_id -> our-uuid lookup so we
  // can resolve parents without a DB round-trip per game.
  const allGames: { id: string; igdb_id: number; title: string; parent_game_id: string | null }[] = [];
  const PAGE_SIZE = 1000;
  let page = 0;

  while (true) {
    const { data, error } = await db
      .from('games')
      .select('id, igdb_id, title, parent_game_id')
      .not('igdb_id', 'is', null)
      .order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to fetch games from DB:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allGames.push(...(data as any));
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const igdbToUuid = new Map<number, string>(allGames.map(g => [g.igdb_id, g.id]));

  const total = allGames.length;
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  console.log(`Resolving parents for ${total} games in ${totalBatches} batches...\n`);

  let processed = 0;
  let linked = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = allGames.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} games)... `);

    const igdbGames = await igdbFetch(`
      fields id, parent_game, version_parent;
      where id = (${batch.map(g => g.igdb_id).join(',')});
      limit ${BATCH_SIZE};
    `);
    const igdbByIgdbId = new Map<number, any>(igdbGames.map(g => [g.id, g]));

    for (const game of batch) {
      const igdbData = igdbByIgdbId.get(game.igdb_id);
      if (!igdbData) continue;

      const parentIgdbId = igdbData.parent_game ?? igdbData.version_parent ?? null;
      if (!parentIgdbId) continue;

      const parentUuid = igdbToUuid.get(parentIgdbId);
      // Link existing only — skip if we don't have the base game, or if it's already set.
      if (!parentUuid || parentUuid === game.id || game.parent_game_id === parentUuid) continue;

      const { error: updateError } = await db
        .from('games')
        .update({ parent_game_id: parentUuid })
        .eq('id', game.id);

      if (updateError) console.error(`\n  Update error for "${game.title}":`, updateError.message);
      else linked++;
    }

    processed += batch.length;
    console.log(`done — ${processed}/${total} (${linked} linked so far)`);

    // Stay under IGDB's 4 req/sec limit between batches
    if (i + BATCH_SIZE < total) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nBackfill complete. Linked ${linked} games to a parent.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
