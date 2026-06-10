import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  // Check Steam account is connected
  const { data: profileData } = await db
    .from('profiles')
    .select('steam_id')
    .eq('id', profile.id)
    .single();

  if (!profileData?.steam_id) {
    return json({ error: 'No Steam account connected.' }, 400);
  }

  const steamId = profileData.steam_id;
  const steamApiKey = import.meta.env.STEAM_API_KEY;

  // Fetch owned games from Steam
  let steamGames: Array<{ appid: number; name: string; playtime_forever: number }> = [];
  try {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    );
    const data = await res.json();
    steamGames = data?.response?.games ?? [];
  } catch (e) {
    console.error('[steam/import] GetOwnedGames error:', e);
    return json({ error: 'Could not reach Steam. Please try again.' }, 502);
  }

  if (steamGames.length === 0) {
    return json({ matched: 0, updated: 0, unmatched: 0, total: 0 });
  }

  // Build lowercase→playtime map from Steam library
  const steamByTitle = new Map<string, number>();
  for (const g of steamGames) {
    if (g.name) steamByTitle.set(g.name.toLowerCase().trim(), g.playtime_forever);
  }

  // Match against our games table via DB function (case-insensitive)
  const steamTitles = Array.from(steamByTitle.keys());
  const { data: matchedGames, error: matchError } = await db
    .rpc('match_steam_games', { steam_titles: steamTitles });

  if (matchError) {
    console.error('[steam/import] match_steam_games error:', JSON.stringify(matchError));
    return json({ error: 'Failed to match games.' }, 500);
  }

  const matches: Array<{ id: string; title: string }> = matchedGames ?? [];

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
      // No status yet — add with 'owned'
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

  // Stamp the sync time
  await db.from('profiles')
    .update({ steam_synced_at: new Date().toISOString() })
    .eq('id', profile.id);

  return json({
    matched: toInsert.length,
    updated: toUpdatePlaytime.length,
    unmatched: steamGames.length - matches.length,
    total: steamGames.length,
  });
};
