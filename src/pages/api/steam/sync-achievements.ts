import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const BATCH_SIZE = 10;
const CONCURRENCY = 3;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
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

  // Fetch the user's full Steam library as the sync source.
  const ownedData = await fetchJson(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
  );
  const allOwned: Array<{ appid: number; name: string }> =
    ownedData?.response?.games ?? [];

  if (allOwned.length === 0) {
    return json({ processed: 0, total: 0, done: true });
  }

  // Sort by appid so the cursor is stable, then take the next batch.
  const sorted = allOwned.sort((a, b) => a.appid - b.appid);
  const batch  = sorted.filter(g => g.appid > cursor).slice(0, BATCH_SIZE);
  const total  = allOwned.length;

  if (batch.length === 0) {
    return json({ processed: total, total, nextCursor: null, done: true });
  }

  // For games already in Chekpoint, look up the internal game_id so we can
  // link achievements to the games table.
  const batchAppids = batch.map(g => g.appid);
  const { data: statusRows } = await (db as any)
    .from('user_game_status')
    .select('game_id, steam_appid')
    .eq('profile_id', profile.id)
    .in('steam_appid', batchAppids);
  const gameIdByAppid = new Map<number, string>(
    (statusRows ?? []).map((r: any) => [r.steam_appid, r.game_id])
  );

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const group = batch.slice(i, i + CONCURRENCY);
    await Promise.allSettled(group.map(async ({ appid, name }) => {
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

        const game_id = gameIdByAppid.get(appid) ?? null;
        const now     = new Date().toISOString();

        const rows = playerAchs.map((pa: any) => {
          const schema = schemaByName.get(pa.apiname) ?? {};
          return {
            profile_id:       profile.id,
            game_id,
            steam_appid:      appid,
            steam_game_title: name,
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

        // Split into unlocked and locked rows.
        // Unlocked achievements are always upserted — they are definitive.
        // Locked achievements use ignoreDuplicates so an existing unlocked=true
        // row is NEVER overwritten to false by a transient bad API response.
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

  // Use the max appid in the batch as the cursor — batch is sorted so this is
  // always batch[last]. Avoids the race condition where concurrent promises
  // writing to a shared lastAppid variable could produce a lower-than-max value,
  // causing games to be re-processed on the next call.
  const lastAppid      = batch[batch.length - 1].appid;
  const processedCount = sorted.filter(g => g.appid <= lastAppid).length;
  const done           = batch.length < BATCH_SIZE;

  if (done) {
    await (db as any)
      .from('profiles')
      .update({ achievements_synced_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  return json({
    processed:  processedCount,
    total,
    nextCursor: done ? null : lastAppid,
    done,
  });
};
