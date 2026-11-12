import type { APIRoute } from "astro";
import { requireAuth, json, type SupabaseAdmin } from "../../../utils/api";
import { igdbFetch } from "../../../utils/igdb";
import { importGameByIgdbId } from "../../../utils/games";

// PostgREST encodes .in() as URL query params — large arrays get silently
// truncated. Keep each chunk well inside any gateway URL limit.
const IN_CHUNK = 100;
// Insert / RPC payload chunk — large enough to be efficient, small enough to
// avoid body-size issues at Supabase's API gateway.
const WRITE_CHUNK = 500;
// match_steam_games is now ID-based (steam_appid lookup against game_steam_apps),
// so one row per input appid. TITLE_CHUNK is retained as the batch size.
const TITLE_CHUNK = 200;

// Per-sync cap on IGDB-driven imports — each importGameByIgdbId on a first-
// sight game can take 500-1500ms (IGDB metadata fetch + genre/platform/dev
// joins). Capping keeps us under Netlify's 10s budget on a cold library;
// subsequent syncs drain the rest (cooldown is 60s). Hits against games
// already in chekpoint are much cheaper — just a game_steam_apps upsert —
// and aren't counted toward this cap.
const IGDB_AUTO_IMPORT_CAP = 20;

// IGDB external_games category for the Steam storefront. Same constant as
// collectSteamAppids() uses in utils/games.ts — kept in sync by both referring
// to the IGDB docs value (1 = Steam).
const IGDB_EXTERNAL_STEAM = 1;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Fire-and-forget — logging a sync gap must never fail the actual sync. Names
// are the display titles from Steam; title_key dedup lives in the SQL function.
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
  let steamGames: Array<{ appid: number; name: string; playtime_forever: number; rtime_last_played?: number }> = [];
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

  // Steam returns an empty list (not an error) when "Game details" is private,
  // so treat it as a failure the client can explain.
  if (steamGames.length === 0) {
    return json({
      error: 'No games found in your Steam library. Make sure your Steam "Game details" privacy setting is Public.',
      code: 'steam_private',
    }, 422);
  }

  // Index Steam's response by appid — the stable identifier we match on. The
  // old code indexed by lowercase title and later had to look playtime/last-
  // played back up by the steam_title the matcher happened to echo; matching
  // on appid removes that indirection entirely.
  type SteamEntry = { appid: number; name: string; playtime: number; lastPlayed: string | null };
  const entryByAppid = new Map<number, SteamEntry>();
  for (const g of steamGames) {
    if (!g.name || !g.appid) continue;
    entryByAppid.set(g.appid, {
      appid: g.appid,
      name: g.name,
      playtime: g.playtime_forever,
      // rtime_last_played is unix-seconds; 0 means "never played / unknown".
      lastPlayed: g.rtime_last_played && g.rtime_last_played > 0
        ? new Date(g.rtime_last_played * 1000).toISOString()
        : null,
    });
  }

  // Match against our games table by appid via game_steam_apps (many appids
  // can map to one canonical game — editions, regional releases). Previously
  // the matcher did normalized title + trigram fuzzy matching with an
  // arbitrary ORDER BY c.id ASC tiebreak — same class of bug fixed on PSN in
  // 20261111000001, demonstrated there by the Ratchet & Clank 2002-vs-2016
  // case. Steam title ambiguity is rarer but the fix is strictly better and
  // the appid bridge already exists (game_steam_apps, populated by
  // importGameByIgdbId's persistSteamAppsFromIgdb).
  const steamAppids = Array.from(entryByAppid.keys());
  console.log(`[steam/import] Matching ${steamAppids.length} appids via game_steam_apps`);

  const matchBatchResults = await Promise.all(
    chunk(steamAppids, TITLE_CHUNK).map(batch =>
      (db as any).rpc('match_steam_games', { steam_appids: batch })
    )
  );

  type MatchRow = { id: string; steam_appid: number };
  const matches: MatchRow[] = [];
  const seenMatchedIds = new Set<string>();
  for (const { data: batchMatches, error: matchError } of matchBatchResults) {
    if (matchError) {
      console.error('[steam/import] match_steam_games error:', JSON.stringify(matchError));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (batchMatches ?? []) as MatchRow[]) {
      if (!seenMatchedIds.has(row.id)) {
        seenMatchedIds.add(row.id);
        matches.push(row);
      }
    }
  }

  // IGDB auto-import pass for appids not already bridged in game_steam_apps.
  // Steam → IGDB is deterministic: one batch query against external_games
  // where category = 1 (Steam) AND uid = <appid-as-string> returns {uid, game}
  // pairs. For each, importGameByIgdbId handles both branches — if the game
  // is already in chekpoint it just upserts game_steam_apps (fast path, not
  // counted against the cap); if new it does the full IGDB import (slow).
  // Anything IGDB doesn't know gets logged for admin review.
  const matchedAppids = new Set(matches.map(m => m.steam_appid));
  const unmatchedAppids = steamAppids.filter(a => !matchedAppids.has(a));

  if (unmatchedAppids.length > 0) {
    // Batch lookup — IGDB's where clause supports uid = ("a","b",...) on
    // string uids. One call per batch of appids.
    const igdbByAppid = new Map<number, number>();
    for (const batch of chunk(unmatchedAppids, 100)) {
      const uidList = batch.map(a => `"${a}"`).join(',');
      try {
        const rows = await igdbFetch(
          'external_games',
          `
            fields game, uid;
            where category = ${IGDB_EXTERNAL_STEAM} & uid = (${uidList});
            limit ${batch.length};
          `,
        );
        for (const r of (Array.isArray(rows) ? rows : []) as Array<{ game: number; uid: string }>) {
          const a = parseInt(r.uid, 10);
          if (Number.isFinite(a) && typeof r.game === 'number') igdbByAppid.set(a, r.game);
        }
      } catch (e) {
        console.error('[steam/import] IGDB external_games batch error:', e);
      }
    }

    // Import — capped at IGDB_AUTO_IMPORT_CAP *new* games per sync. Existing
    // games (importGameByIgdbId's fast branch) don't count because they just
    // upsert game_steam_apps and return — tens of milliseconds each.
    let newImportCount = 0;
    for (const appid of unmatchedAppids) {
      const igdbId = igdbByAppid.get(appid);
      if (!igdbId) {
        // IGDB doesn't know this appid — defer to admin.
        continue;
      }
      // Peek at whether the game already exists; if yes, importGameByIgdbId
      // just upserts game_steam_apps and returns fast (not counted).
      const { data: existing } = await (db as any)
        .from('games')
        .select('id')
        .eq('igdb_id', igdbId)
        .maybeSingle();
      if (!existing && newImportCount >= IGDB_AUTO_IMPORT_CAP) continue;

      const result = await importGameByIgdbId(db, igdbId);
      if (!result.ok) {
        console.error('[steam/import] auto-import failed for appid', appid, result.error);
        continue;
      }
      if (!existing) newImportCount++;
      if (!seenMatchedIds.has(result.game.id)) {
        seenMatchedIds.add(result.game.id);
        matches.push({ id: result.game.id, steam_appid: appid });
      }
    }

    // Anything we still couldn't resolve → unmatched log. Includes IGDB
    // misses and whatever got deferred by the cap.
    const resolvedAppids = new Set(matches.map(m => m.steam_appid));
    const stillUnmatched = unmatchedAppids
      .filter(a => !resolvedAppids.has(a))
      .map(a => entryByAppid.get(a)?.name)
      .filter((n): n is string => !!n);
    logUnmatchedTitles(db, stillUnmatched);
  }

  console.log(`[steam/import] matched ${matches.length} / ${steamAppids.length} appids`);

  if (matches.length === 0) {
    await db.from('profiles').update({ steam_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: steamGames.length, total: steamGames.length });
  }

  // Resolve every matched row to its canonical main game — a collapsed edition
  // (port/remaster/GOTY) records ownership on the game it belongs to, not itself.
  // Chunk .in() to avoid URL truncation (PostgREST query-string encoding).
  const matchedGameIds = matches.map(m => m.id);
  const canonicalOf = new Map<string, string>();
  const canonChunks = await Promise.all(
    chunk(matchedGameIds, IN_CHUNK).map(ids =>
      db.from('games').select('id, canonical_game_id').in('id', ids)
    )
  );
  for (const { data: rows } of canonChunks) {
    for (const r of ((rows ?? []) as any[])) {
      canonicalOf.set(r.id, r.canonical_game_id ?? r.id);
    }
  }

  // For each canonical game, aggregate playtime across every owned edition that
  // collapses into it. Pick appid / last_played from whichever edition the user
  // has played most recently (fallback: highest-playtime edition) so refresh
  // writes reflect the primary edition they're actually playing. With appid-
  // based matching we read directly from the match row's steam_appid instead
  // of the old title → appid indirection.
  const perCanonical = new Map<string, {
    playtime: number;
    appid: number | null;
    lastPlayed: string | null;
    _lastPlayedTs: number;
    _bestPlaytime: number;
  }>();
  for (const game of matches) {
    const canonicalId = canonicalOf.get(game.id) ?? game.id;
    const entry       = entryByAppid.get(game.steam_appid);
    const playtime    = entry?.playtime ?? 0;
    const appid       = game.steam_appid;
    const lastPlayed  = entry?.lastPlayed ?? null;
    const lastPlayedTs = lastPlayed ? Date.parse(lastPlayed) : 0;

    const existing = perCanonical.get(canonicalId);
    if (!existing) {
      perCanonical.set(canonicalId, {
        playtime,
        appid,
        lastPlayed,
        _lastPlayedTs: lastPlayedTs,
        _bestPlaytime: playtime,
      });
    } else {
      existing.playtime += playtime;
      // Prefer most-recently-played edition's appid/last_played; fall back to
      // highest-playtime edition's.
      const beats =
        lastPlayedTs > existing._lastPlayedTs ||
        (lastPlayedTs === existing._lastPlayedTs && playtime > existing._bestPlaytime);
      if (beats) {
        existing.appid = appid;
        existing.lastPlayed = lastPlayed;
        existing._lastPlayedTs = lastPlayedTs;
        existing._bestPlaytime = playtime;
      }
    }
  }

  // Load existing statuses keyed by canonical game, chunked for URL safety.
  const canonicalIds = [...perCanonical.keys()];
  const existingByGameId = new Map<string, string>();
  const existingChunks = await Promise.all(
    chunk(canonicalIds, IN_CHUNK).map(ids =>
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
  const toUpdatePlaytime: Array<{ game_id: string; playtime: number; appid: number | null; last_played: string | null }> = [];

  for (const [gameId, agg] of perCanonical) {
    const { playtime, appid, lastPlayed } = agg;
    const existing = existingByGameId.get(gameId);

    if (!existing) {
      // Skip 0-hour games when playedOnly is set
      if (playedOnly && playtime === 0) continue;
      toInsert.push({
        profile_id: profile.id,
        game_id: gameId,
        status: 'owned',
        is_owned: true,
        steam_playtime_minutes: playtime,
        steam_appid: appid,
        steam_last_played_at: lastPlayed,
      });
    } else {
      // Already tracked (e.g. auto-added when the user reviewed it) — refresh
      // playtime / appid / last-played without touching their chosen status.
      toUpdatePlaytime.push({ game_id: gameId, playtime, appid, last_played: lastPlayed });
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
    const updatePayload = toUpdatePlaytime.map(({ game_id, playtime, appid, last_played }) => ({ game_id, playtime, appid, last_played }));
    for (const batch of chunk(updatePayload, WRITE_CHUNK)) {
      // Pass the array itself — a jsonb param. JSON.stringify(batch) arrives as a
      // jsonb *string* scalar, so jsonb_array_elements() inside the function
      // errors out ("cannot extract elements from a scalar") and every
      // already-tracked game (e.g. one added by reviewing it) silently kept its
      // old NULL steam_appid / playtime.
      const { error: updateError } = await (db as any).rpc('bulk_update_steam_playtime', {
        p_profile_id: profile.id,
        p_updates: batch,
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
