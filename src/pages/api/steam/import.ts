import type { APIRoute } from "astro";
import { requireAuth, json, type SupabaseAdmin } from "../../../utils/api";

// PostgREST encodes .in() as URL query params — large arrays get silently
// truncated. Keep each chunk well inside any gateway URL limit.
const IN_CHUNK = 100;
// Insert / RPC payload chunk — large enough to be efficient, small enough to
// avoid body-size issues at Supabase's API gateway.
const WRITE_CHUNK = 500;
// Batch size for the matcher RPCs.
const TITLE_CHUNK = 200;

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

  // Step 1 — appid fast path. Resolves games that already have a mapping in
  // game_steam_apps (populated by importGameByIgdbId's persistSteamAppsFromIgdb
  // on any game imported via the IGDB flow). For games that don't have a
  // mapping yet — which is the overwhelming majority of chekpoint's existing
  // catalog, since persistSteamAppsFromIgdb is a recent addition — we fall
  // back to title matching in step 2.
  const steamAppids = Array.from(entryByAppid.keys());
  console.log(`[steam/import] Step 1: appid match for ${steamAppids.length} appids`);

  const appidBatches = await Promise.all(
    chunk(steamAppids, TITLE_CHUNK).map(batch =>
      (db as any).rpc('match_steam_games', { steam_appids: batch })
    )
  );

  type AppidMatchRow = { id: string; steam_appid: number };
  const matches: Array<{ id: string; steam_appid: number }> = [];
  const seenMatchedIds = new Set<string>();
  for (const { data: batchMatches, error: matchError } of appidBatches) {
    if (matchError) {
      console.error('[steam/import] appid match_steam_games error:', JSON.stringify(matchError));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (batchMatches ?? []) as AppidMatchRow[]) {
      if (!seenMatchedIds.has(row.id)) {
        seenMatchedIds.add(row.id);
        matches.push({ id: row.id, steam_appid: row.steam_appid });
      }
    }
  }

  // Step 2 — title fallback for appids the appid path didn't resolve. Uses
  // the title-based matcher that was in place before PR #110 (restored in
  // 20261112000000 so it coexists with the appid version; Postgres resolves
  // the right one by argument name). Not deterministic for games sharing a
  // normalized title, but that's a rare edge for Steam (unlike PSN where it
  // was the primary failure mode); the alternative is zero games imported.
  const matchedAppids = new Set(matches.map(m => m.steam_appid));
  const unmatchedAppids = steamAppids.filter(a => !matchedAppids.has(a));

  if (unmatchedAppids.length > 0) {
    // Build title → appid reverse lookup so we can tie each title-match row
    // back to the appid it came from.
    const appidByLowerName = new Map<string, number>();
    for (const appid of unmatchedAppids) {
      const entry = entryByAppid.get(appid);
      if (entry?.name) appidByLowerName.set(entry.name.toLowerCase().trim(), appid);
    }
    const unmatchedTitles = [...appidByLowerName.keys()]
      .map(k => entryByAppid.get(appidByLowerName.get(k)!)?.name)
      .filter((n): n is string => !!n);

    console.log(`[steam/import] Step 2: title match for ${unmatchedTitles.length} unmatched appids`);

    const titleBatches = await Promise.all(
      chunk(unmatchedTitles, TITLE_CHUNK).map(batch =>
        (db as any).rpc('match_steam_games', { steam_titles: batch })
      )
    );

    type TitleMatchRow = { id: string; title: string; steam_title: string };
    const matchedTitles = new Set<string>();
    for (const { data: batchMatches, error: matchError } of titleBatches) {
      if (matchError) {
        console.error('[steam/import] title match_steam_games error:', JSON.stringify(matchError));
        return json({ error: 'Failed to match games.' }, 500);
      }
      for (const row of (batchMatches ?? []) as TitleMatchRow[]) {
        if (seenMatchedIds.has(row.id)) continue;
        const appid = appidByLowerName.get((row.steam_title ?? row.title).toLowerCase().trim());
        if (appid == null) continue;
        seenMatchedIds.add(row.id);
        matches.push({ id: row.id, steam_appid: appid });
        matchedTitles.add((row.steam_title ?? row.title).toLowerCase().trim());
      }
    }

    // Log unmatched titles for admin review — mirrors prior behavior.
    const unmatchedForLog = unmatchedTitles.filter(
      t => !matchedTitles.has(t.toLowerCase().trim())
    );
    logUnmatchedTitles(db, unmatchedForLog);
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
