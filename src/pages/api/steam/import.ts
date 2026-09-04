import type { APIRoute } from "astro";
import { requireAuth, json, type SupabaseAdmin } from "../../../utils/api";

// PostgREST encodes .in() as URL query params — large arrays get silently
// truncated. Keep each chunk well inside any gateway URL limit.
const IN_CHUNK = 100;
// Insert / RPC payload chunk — large enough to be efficient, small enough to
// avoid body-size issues at Supabase's API gateway.
const WRITE_CHUNK = 500;
// match_steam_games returns at most one row per input title (ROW_NUMBER rn=1).
// Chunking inputs keeps each RPC response well under Supabase's max-rows=1000
// hard cap, which Range-header pagination cannot reliably override on RPC calls.
const TITLE_CHUNK = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Fire-and-forget — logging a sync gap must never fail the actual sync.
function logUnmatchedTitles(db: SupabaseAdmin, titles: string[]): void {
  if (titles.length === 0) return;
  (db as any).rpc('log_unmatched_steam_titles', { titles }).then(
    ({ error }: any) => {
      if (error) console.error('[steam/import] log_unmatched_steam_titles error (non-fatal):', JSON.stringify(error));
    }
  );
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  // Check Steam account is connected
  const { data: profileData } = await db
    .from('profiles')
    .select('steam_id, steam_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.steam_id) {
    return json({ error: 'No Steam account connected.' }, 400);
  }

  // Enforce 1-minute cooldown between syncs
  if (profileData.steam_synced_at) {
    const secondsSinceSync = (Date.now() - new Date(profileData.steam_synced_at).getTime()) / 1000;
    if (secondsSinceSync < 60) {
      const wait = Math.ceil(60 - secondsSinceSync);
      return json({ error: `Please wait ${wait}s before syncing again.` }, 429);
    }
  }

  const steamId = profileData.steam_id;
  const steamApiKey = import.meta.env.STEAM_API_KEY;

  if (!steamApiKey) {
    console.error('[steam/import] STEAM_API_KEY is not set');
    return json({ error: 'Steam API is not configured. Please contact support.' }, 500);
  }

  // Fetch owned games from Steam
  let steamGames: Array<{ appid: number; name: string; playtime_forever: number }> = [];
  try {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`[steam/import] Steam returned HTTP ${res.status}:`, text.slice(0, 200));
      return json({ error: `Steam returned an error (HTTP ${res.status}). Please try again.` }, 502);
    }
    const data = await res.json();
    steamGames = data?.response?.games ?? [];
  } catch (e) {
    console.error('[steam/import] GetOwnedGames fetch/parse error:', e);
    return json({ error: `Could not reach Steam (network error). Please try again.` }, 502);
  }

  // Optional: only import/keep games with playtime > 0
  const body = await context.request.json().catch(() => ({}));
  const playedOnly = body.playedOnly === true;

  console.log(`[steam/import] Steam returned ${steamGames.length} games for steamId=${steamId}`);

  if (steamGames.length === 0) {
    return json({ matched: 0, updated: 0, unmatched: 0, total: 0, removed: 0 });
  }

  // Build lowercase→playtime and lowercase→appid maps from Steam library
  const steamByTitle = new Map<string, number>();
  const appidByTitle  = new Map<string, number>();
  const originalCaseByTitle = new Map<string, string>();
  for (const g of steamGames) {
    if (g.name) {
      const key = g.name.toLowerCase().trim();
      steamByTitle.set(key, g.playtime_forever);
      appidByTitle.set(key, g.appid);
      originalCaseByTitle.set(key, g.name);
    }
  }

  // Match against our games table via DB function (case-insensitive).
  // Chunk input titles so each RPC call handles at most TITLE_CHUNK titles.
  // match_steam_games returns at most one row per input title, so each batch
  // returns ≤ TITLE_CHUNK rows — safely under Supabase's max-rows=1000 cap.
  // (Range-header pagination on RPC calls is unreliable when the function uses
  //  SELECT DISTINCT without ORDER BY, and max-rows still caps the page size.)
  const steamTitles = Array.from(steamByTitle.keys());
  console.log(`[steam/import] Sending ${steamTitles.length} titles to match_steam_games`);
  console.log(`[steam/import] Sample Steam titles (first 20):`, steamTitles.slice(0, 20));

  // Fire all title batches in parallel — sequential calls were eating the
  // entire Netlify 10s timeout before the INSERT step could run.
  const matchBatchResults = await Promise.all(
    chunk(steamTitles, TITLE_CHUNK).map(titleBatch =>
      (db as any).rpc('match_steam_games', { steam_titles: titleBatch })
    )
  );

  const allMatchedGames: Array<{ id: string; title: string }> = [];
  const seenMatchedIds = new Set<string>();
  for (const { data: batchMatches, error: matchError } of matchBatchResults) {
    if (matchError) {
      console.error('[steam/import] match_steam_games error:', JSON.stringify(matchError));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (batchMatches ?? []) as Array<{ id: string; title: string }>) {
      if (!seenMatchedIds.has(row.id)) {
        seenMatchedIds.add(row.id);
        allMatchedGames.push(row);
      }
    }
  }
  const matches = allMatchedGames;

  console.log(`[steam/import] match_steam_games returned ${matches.length} matches:`, matches.map(m => m.title));

  if (matches.length > 0) {
    const matchedTitlesSet = new Set(matches.map(m => m.title.toLowerCase().trim()));
    const unmatched = steamTitles.filter(t => !matchedTitlesSet.has(t));
    console.log(`[steam/import] Unmatched Steam titles (${unmatched.length}):`, unmatched);
    logUnmatchedTitles(db, unmatched.map(t => originalCaseByTitle.get(t) ?? t));
  }

  if (matches.length === 0) {
    logUnmatchedTitles(db, steamGames.map(g => g.name));
    await db.from('profiles').update({ steam_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: steamGames.length, total: steamGames.length });
  }

  // Get this user's existing game statuses to avoid overwriting manual entries.
  // Chunk .in() to avoid URL truncation — large arrays get silently cut off by
  // PostgREST's query-string encoding, causing games to appear non-existent and
  // then fail on INSERT with a unique-constraint violation.
  const matchedGameIds = matches.map(m => m.id);
  const existingByGameId = new Map<string, string>();
  const existingChunks = await Promise.all(
    chunk(matchedGameIds, IN_CHUNK).map(ids =>
      (db as any)
        .from('user_game_status')
        .select('game_id, status')
        .eq('profile_id', profile.id)
        .in('game_id', ids)
    )
  );
  for (const { data: rows } of existingChunks) {
    for (const r of (rows ?? [])) existingByGameId.set(r.game_id, r.status);
  }

  const toInsert: any[] = [];
  const toUpdatePlaytime: Array<{ game_id: string; playtime: number }> = [];
  const seenGameIds = new Set<string>();

  for (const game of matches) {
    // Deduplicate — match_steam_games can return the same game_id multiple times
    // if several Steam titles match the same Chekpoint game (e.g. GOTY editions)
    if (seenGameIds.has(game.id)) continue;
    seenGameIds.add(game.id);

    const key     = game.title.toLowerCase().trim();
    const playtime = steamByTitle.get(key) ?? 0;
    const appid    = appidByTitle.get(key) ?? null;
    const existing = existingByGameId.get(game.id);

    if (!existing) {
      // Skip 0-hour games when playedOnly is set
      if (playedOnly && playtime === 0) continue;
      toInsert.push({
        profile_id: profile.id,
        game_id: game.id,
        status: 'owned',
        is_owned: true,
        steam_playtime_minutes: playtime,
        steam_appid: appid,
      });
    } else {
      // Already tracked — only update playtime and appid
      toUpdatePlaytime.push({ game_id: game.id, playtime });
    }
  }

  // Chunked INSERT — avoids large single-request body failures
  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    const { error: insertError } = await (db as any).from('user_game_status').insert(batch);
    if (insertError) {
      console.error('[steam/import] insert error:', JSON.stringify(insertError));
      return json({ error: 'Failed to save game statuses.' }, 500);
    }
  }

  // Bulk playtime update via RPC — replaces one-at-a-time loop that would
  // timeout on large libraries (e.g. 2000 games × 1 HTTP call each = ~200s)
  if (toUpdatePlaytime.length > 0) {
    const updatePayload = toUpdatePlaytime.map(({ game_id, playtime }) => ({ game_id, playtime }));
    for (const batch of chunk(updatePayload, WRITE_CHUNK)) {
      const { error: updateError } = await (db as any).rpc('bulk_update_steam_playtime', {
        p_profile_id: profile.id,
        p_updates: JSON.stringify(batch),
      });
      if (updateError) {
        console.error('[steam/import] playtime update error (non-fatal):', JSON.stringify(updateError));
      }
    }
  }

  // If playedOnly, remove any existing 'owned' rows that were imported with 0 playtime
  // (steam_playtime_minutes = 0 means Steam-imported with no hours; NULL means manually added)
  let removed = 0;
  if (playedOnly) {
    const { data: removed0, error: removeError } = await (db as any)
      .from('user_game_status')
      .delete()
      .eq('profile_id', profile.id)
      .eq('status', 'owned')
      .eq('steam_playtime_minutes', 0)
      .select('id');
    if (removeError) {
      console.error('[steam/import] remove 0-hour error:', JSON.stringify(removeError));
    } else {
      removed = removed0?.length ?? 0;
    }
  }

  // Stamp the sync time
  await db.from('profiles')
    .update({ steam_synced_at: new Date().toISOString() })
    .eq('id', profile.id);

  return json({
    matched: toInsert.length,
    updated: toUpdatePlaytime.length,
    unmatched: steamGames.length - matches.length,
    total: steamGames.length,
    removed,
  });
};
