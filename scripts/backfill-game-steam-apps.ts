/**
 * One-time backfill of game_steam_apps from IGDB external_games.
 *
 * Problem: game_steam_apps is only populated by importGameByIgdbId's
 * persistSteamAppsFromIgdb helper, which is relatively recent. The vast
 * majority of chekpoint's catalog was imported before that existed, so
 * the appid → game_id bridge is nearly empty — steam/import.ts's ID fast
 * path misses almost everything and has to fall back to title matching.
 *
 * Fix: for every game with an igdb_id, query IGDB external_games with
 * external_game_source = 1 (Steam) and upsert each (steam_appid, game_id)
 * mapping. After this runs, most of chekpoint's existing games will be
 * resolvable via the ID fast path in future Steam syncs.
 *
 * Idempotent — safe to re-run. Uses `upsert` with `ignoreDuplicates: true`,
 * which translates to `INSERT ... ON CONFLICT DO NOTHING` — existing
 * steam_appid → game_id mappings are never overwritten. New mappings are
 * added. If IGDB's data disagrees with a manually-set mapping, the manual
 * one wins (safer default — nothing in the DB is silently mutated).
 *
 * Safety audit:
 * - Reads: games (igdb_id, id), game_steam_apps (for the skip-count). No writes.
 * - IGDB: external_games endpoint, read-only external call.
 * - Writes: game_steam_apps only. No triggers on this table. ON DELETE CASCADE
 *   from games(id); we never delete here, only insert.
 * - The `ignoreDuplicates: true` flag guarantees existing rows are untouched.
 * - No other table, no RLS policy change, no schema change.
 *
 * Run: npx tsx scripts/backfill-game-steam-apps.ts
 * Requires: SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IGDB_CLIENT_ID,
 *   IGDB_CLIENT_SECRET in .env.
 *
 * IGDB rate limit: 4 req/sec per client. We batch 500 IGDB game ids per
 * external_games query; a catalog of ~N games means ceil(N/500) IGDB calls.
 * Steam's `limit 500` per request matches IGDB's max page size.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const IGDB_URL = 'https://api.igdb.com/v4';
const IGDB_EXTERNAL_STEAM = 1;

// How many IGDB game ids per external_games query. IGDB's per-response max
// is 500; stay under that.
const IGDB_LOOKUP_CHUNK = 500;

// How many mapping rows per upsert. Supabase gateway body-size limit guard.
const UPSERT_CHUNK = 500;

// Pause between IGDB calls to stay under the 4 req/sec rate limit. 300ms
// gives us ~3.3 req/sec, well under the cap.
const IGDB_PAUSE_MS = 300;

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let cachedToken: string | null = null;
async function getIgdbToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}` +
      `&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error('No IGDB access_token in response');
  cachedToken = data.access_token;
  return cachedToken;
}

async function igdb(endpoint: string, query: string): Promise<unknown[]> {
  const token = await getIgdbToken();
  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });
  if (!res.ok) {
    console.error(`[backfill] IGDB ${endpoint} error: HTTP ${res.status}`, (await res.text()).slice(0, 200));
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  // Pull every game with an igdb_id. Pagination required — Supabase caps at
  // 1000 rows per request even for the admin client.
  console.log('[backfill] loading games from DB...');
  const igdbIdByGameId = new Map<number, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('games')
      .select('id, igdb_id')
      .not('igdb_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[backfill] games fetch error:', JSON.stringify(error));
      process.exit(1);
    }
    for (const g of data ?? []) {
      if (typeof g.igdb_id === 'number') igdbIdByGameId.set(g.igdb_id, g.id);
    }
    if (!data || data.length < PAGE) break;
  }
  console.log(`[backfill] ${igdbIdByGameId.size} games with igdb_id`);

  // Process every game. Skipping already-mapped games would make re-runs
  // cheaper but would also miss additional appids IGDB knows about for a
  // game that already has one mapping (regional variants, editions). The
  // upsert's ignoreDuplicates flag handles re-run safety.
  const { count: existingCount } = await db
    .from('game_steam_apps')
    .select('*', { count: 'exact', head: true });
  console.log(`[backfill] ${existingCount ?? '?'} rows already in game_steam_apps (will not be overwritten)`);
  const todo = Array.from(igdbIdByGameId.keys());

  // Batch-query IGDB external_games filtering by game IN list. One IGDB call
  // can resolve up to IGDB_LOOKUP_CHUNK game ids.
  const pendingUpserts: Array<{ steam_appid: number; game_id: string }> = [];
  let totalFound = 0;
  for (const batch of chunk(todo, IGDB_LOOKUP_CHUNK)) {
    const gameList = batch.join(',');
    const rows = (await igdb(
      'external_games',
      `
        fields game, uid;
        where external_game_source = ${IGDB_EXTERNAL_STEAM} & game = (${gameList});
        limit ${batch.length};
      `,
    )) as Array<{ game: number; uid: string }>;

    for (const r of rows) {
      const appid = parseInt(r.uid, 10);
      const gameId = igdbIdByGameId.get(r.game);
      if (Number.isFinite(appid) && appid > 0 && gameId) {
        pendingUpserts.push({ steam_appid: appid, game_id: gameId });
      }
    }
    totalFound += rows.length;
    console.log(`[backfill] processed ${Math.min(batch.length, totalFound)}/${todo.length} (total mappings found: ${pendingUpserts.length})`);

    await new Promise(r => setTimeout(r, IGDB_PAUSE_MS));
  }

  // Deduplicate — one appid may show up in two IGDB external_games rows
  // pointing to the same chekpoint game (e.g. regional entries). Upsert
  // conflict on PK handles it, but dedup here keeps the payload smaller.
  const seenAppids = new Set<number>();
  const uniqueUpserts = pendingUpserts.filter(u => {
    if (seenAppids.has(u.steam_appid)) return false;
    seenAppids.add(u.steam_appid);
    return true;
  });
  console.log(`[backfill] upserting ${uniqueUpserts.length} appid → game_id mappings`);

  let written = 0;
  for (const batch of chunk(uniqueUpserts, UPSERT_CHUNK)) {
    // ignoreDuplicates: true → INSERT ... ON CONFLICT DO NOTHING. Existing
    // (steam_appid) rows are preserved. New appids are added. This is the
    // safe default — if IGDB disagrees with an existing manual mapping, the
    // manual one wins, no silent data mutation.
    const { error } = await db
      .from('game_steam_apps')
      .upsert(batch, { onConflict: 'steam_appid', ignoreDuplicates: true });
    if (error) {
      console.error('[backfill] upsert error:', JSON.stringify(error));
      continue;
    }
    written += batch.length;
  }

  const { count: finalCount } = await db
    .from('game_steam_apps')
    .select('*', { count: 'exact', head: true });
  console.log(`[backfill] done — attempted ${written} upserts; table now has ${finalCount ?? '?'} rows (was ${existingCount ?? '?'})`);
}

main().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});
