import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const BATCH_SIZE = 15;
const CONCURRENCY = 3;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({}));
  const cursor: number = body.cursor ?? 0;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('steam_id, achievements_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.steam_id) {
    return json({ error: 'No Steam account connected.' }, 400);
  }

  const lastSync = (profileData as any).achievements_synced_at;
  if (lastSync && body.cursor == null) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < 3600) {
      const mins = Math.ceil((3600 - secondsSince) / 60);
      return json({ error: `Please wait ${mins} minute${mins !== 1 ? 's' : ''} before syncing again.` }, 429);
    }
  }

  const steamId     = profileData.steam_id as string;
  const steamApiKey = import.meta.env.STEAM_API_KEY;
  if (!steamApiKey) return json({ error: 'Steam API not configured.' }, 500);

  // Source: games the user has in their Chekpoint library with a steam_appid.
  // These are the games whose achievement stats are accessible via the API key.
  // (Steam's Web API only returns achievement data for games with public stats;
  // the full GetOwnedGames approach returns empty for ~95% of games.)
  const { data: gameRows, error: gameErr } = await (db as any)
    .from('user_game_status')
    .select('game_id, steam_appid')
    .eq('profile_id', profile.id)
    .not('steam_appid', 'is', null)
    .gt('steam_appid', cursor)
    .order('steam_appid', { ascending: true })
    .limit(BATCH_SIZE);

  if (gameErr) {
    console.error('[sync-achievements] game fetch error:', JSON.stringify(gameErr));
    return json({ error: 'Failed to fetch game list.' }, 500);
  }

  const { count: totalCount } = await (db as any)
    .from('user_game_status')
    .select('steam_appid', { count: 'exact', head: true })
    .eq('profile_id', profile.id)
    .not('steam_appid', 'is', null);

  const games: Array<{ game_id: string; steam_appid: number }> = gameRows ?? [];

  if (games.length === 0) {
    await (db as any)
      .from('profiles')
      .update({ achievements_synced_at: new Date().toISOString() })
      .eq('id', profile.id);
    return json({ processed: totalCount ?? 0, total: totalCount ?? 0, nextCursor: null, done: true });
  }

  for (let i = 0; i < games.length; i += CONCURRENCY) {
    const group = games.slice(i, i + CONCURRENCY);
    await Promise.allSettled(group.map(async ({ game_id, steam_appid }) => {
      const appid = steam_appid;
      try {
        const [playerData, schemaData, globalData] = await Promise.all([
          fetchJson(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${steamApiKey}&steamid=${steamId}&l=en`),
          fetchJson(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&key=${steamApiKey}&l=en`),
          fetchJson(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`),
        ]);

        const playerAchs: any[] = playerData?.playerstats?.achievements ?? [];
        if (playerAchs.length === 0) return;

        const schemaAchs: any[] = schemaData?.game?.availableGameStats?.achievements ?? [];
        const globalAchs: any[] = globalData?.achievementpercentages?.achievements ?? [];

        const schemaByName = new Map(schemaAchs.map((a: any) => [a.name, a]));
        const globalByName = new Map(globalAchs.map((a: any) => [a.name, a.percent]));

        // Also fetch the game title from schema for steam_game_title
        const steamGameTitle: string = schemaData?.game?.gameName ?? null;
        const now = new Date().toISOString();

        const rows = playerAchs.map((pa: any) => {
          const schema = schemaByName.get(pa.apiname) ?? {};
          return {
            profile_id:       profile.id,
            game_id:          game_id || null,
            steam_appid:      appid,
            steam_game_title: steamGameTitle,
            api_name:         pa.apiname,
            display_name:     schema.displayName ?? pa.apiname,
            description:      schema.description ?? null,
            icon_url:         schema.icon ?? null,
            icon_gray_url:    schema.icongray ?? null,
            hidden:           schema.hidden === 1,
            unlocked:         pa.achieved === 1,
            unlock_time:      pa.achieved === 1 && pa.unlocktime
              ? new Date(pa.unlocktime * 1000).toISOString()
              : null,
            global_percent:   globalByName.get(pa.apiname) ?? null,
            synced_at:        now,
          };
        });

        if (rows.length === 0) return;

        // Unlocked achievements: always upsert — they are definitive truth.
        // Locked achievements: insert-only (ignoreDuplicates) so a transient
        // bad API response can never overwrite an existing unlocked=true row.
        const unlockedRows = rows.filter(r => r.unlocked);
        const lockedRows   = rows.filter(r => !r.unlocked);

        if (unlockedRows.length > 0) {
          const { error } = await (db as any)
            .from('user_achievements')
            .upsert(unlockedRows, { onConflict: 'profile_id,steam_appid,api_name' });
          if (error) console.error(`[sync-achievements] unlocked upsert appid=${appid}:`, JSON.stringify(error));
        }
        if (lockedRows.length > 0) {
          const { error } = await (db as any)
            .from('user_achievements')
            .upsert(lockedRows, { onConflict: 'profile_id,steam_appid,api_name', ignoreDuplicates: true });
          if (error) console.error(`[sync-achievements] locked upsert appid=${appid}:`, JSON.stringify(error));
        }
      } catch (e) {
        console.error(`[sync-achievements] error processing appid=${appid}:`, e);
      }
    }));
  }

  // Use the max appid in the batch as cursor — games are ordered ascending
  // so this is always games[last].steam_appid. Avoids the race condition
  // where concurrent promises writing to a shared variable produce a
  // lower-than-max value, causing games to be re-processed next call.
  const lastAppid = games[games.length - 1].steam_appid;
  const done      = games.length < BATCH_SIZE;

  if (done) {
    await (db as any)
      .from('profiles')
      .update({ achievements_synced_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  return json({
    processed:  lastAppid,
    total:      totalCount ?? 0,
    nextCursor: done ? null : lastAppid,
    done,
  });
};
