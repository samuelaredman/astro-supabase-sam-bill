import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

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
      return json({ error: 'Could not reach Steam. Please try again.' }, 502);
    }
    const data = await res.json();
    steamGames = data?.response?.games ?? [];
  } catch (e) {
    console.error('[steam/import] GetOwnedGames fetch/parse error:', e);
    return json({ error: 'Could not reach Steam. Please try again.' }, 502);
  }

  // Optional: only import/keep games with playtime > 0
  const body = await context.request.json().catch(() => ({}));
  const playedOnly = body.playedOnly === true;

  console.log(`[steam/import] Steam returned ${steamGames.length} games for steamId=${steamId}`);

  if (steamGames.length === 0) {
    return json({ matched: 0, updated: 0, unmatched: 0, total: 0, removed: 0 });
  }

  // Build lowercase→playtime map from Steam library
  const steamByTitle = new Map<string, number>();
  for (const g of steamGames) {
    if (g.name) steamByTitle.set(g.name.toLowerCase().trim(), g.playtime_forever);
  }

  // Match against our games table via DB function (case-insensitive)
  const steamTitles = Array.from(steamByTitle.keys());

  console.log(`[steam/import] Sending ${steamTitles.length} titles to match_steam_games`);
  console.log(`[steam/import] Sample Steam titles (first 20):`, steamTitles.slice(0, 20));

  const { data: matchedGames, error: matchError } = await db
    .rpc('match_steam_games', { steam_titles: steamTitles });

  if (matchError) {
    console.error('[steam/import] match_steam_games error:', JSON.stringify(matchError));
    return json({ error: 'Failed to match games.' }, 500);
  }

  const matches: Array<{ id: string; title: string }> = matchedGames ?? [];

  console.log(`[steam/import] match_steam_games returned ${matches.length} matches:`, matches.map(m => m.title));

  if (matches.length > 0) {
    const matchedTitlesSet = new Set(matches.map(m => m.title.toLowerCase().trim()));
    const unmatched = steamTitles.filter(t => !matchedTitlesSet.has(t));
    console.log(`[steam/import] Unmatched Steam titles (${unmatched.length}):`, unmatched);
  }

  if (matches.length === 0) {
    await db.from('profiles').update({ steam_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: steamGames.length, total: steamGames.length });
  }

  // Get this user's existing game statuses to avoid overwriting manual entries
  const matchedGameIds = matches.map(m => m.id);
  const { data: existingStatuses } = await db
    .from('user_game_status')
    .select('game_id, status')
    .eq('profile_id', profile.id)
    .in('game_id', matchedGameIds);

  const existingByGameId = new Map<string, string>(
    (existingStatuses ?? []).map((r: any) => [r.game_id, r.status])
  );

  const toInsert: any[] = [];
  const toUpdatePlaytime: any[] = [];
  const seenGameIds = new Set<string>();

  for (const game of matches) {
    // Deduplicate — match_steam_games can return the same game_id multiple times
    // if several Steam titles match the same Chekpoint game (e.g. GOTY editions)
    if (seenGameIds.has(game.id)) continue;
    seenGameIds.add(game.id);

    const playtime = steamByTitle.get(game.title.toLowerCase().trim()) ?? 0;
    const existing = existingByGameId.get(game.id);

    if (!existing) {
      // Skip 0-hour games when playedOnly is set
      if (playedOnly && playtime === 0) continue;
      toInsert.push({
        profile_id: profile.id,
        game_id: game.id,
        status: 'owned',
        steam_playtime_minutes: playtime,
      });
    } else {
      // Already tracked — only update playtime
      toUpdatePlaytime.push({ game_id: game.id, playtime });
    }
  }

  // Bulk insert new rows
  if (toInsert.length > 0) {
    const { error: insertError } = await db.from('user_game_status').insert(toInsert);
    if (insertError) {
      console.error('[steam/import] insert error:', JSON.stringify(insertError));
      return json({ error: 'Failed to save game statuses.' }, 500);
    }
  }

  // Update playtime on existing rows one at a time (no bulk update in PostgREST without RPC)
  for (const { game_id, playtime } of toUpdatePlaytime) {
    await db.from('user_game_status')
      .update({ steam_playtime_minutes: playtime })
      .eq('profile_id', profile.id)
      .eq('game_id', game_id);
  }

  // If playedOnly, remove any existing 'owned' rows that were imported with 0 playtime
  // (steam_playtime_minutes = 0 means Steam-imported with no hours; NULL means manually added)
  let removed = 0;
  if (playedOnly) {
    const { data: removed0, error: removeError } = await db
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
