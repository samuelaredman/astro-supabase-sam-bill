import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// Small batch + sequential-per-game to stay within Steam's rate limits.
// The 3 API calls for a single game still run in parallel (player, schema,
// global) — what we avoid is firing 9-15 simultaneous calls across games.
const BATCH_SIZE = 6;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Retries up to `retries` times with a short delay — used for GetSchemaForGame
// which has a stricter rate limit than the player/global endpoints.
async function fetchJsonWithRetry(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 700 * i));
    const result = await fetchJson(url);
    if (result !== null) return result;
  }
  return null;
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

  // Fetch the full Steam library. One HTTP call, returns quickly.
  const ownedData = await fetchJson(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
  );
  const allOwned: Array<{ appid: number; name: string }> =
    ownedData?.response?.games ?? [];

  if (allOwned.length === 0) {
    return json({ error: 'No Steam games found. Make sure your Steam profile Game Details are set to Public.' }, 400);
  }

  const sorted = allOwned.sort((a, b) => a.appid - b.appid);
  const batch  = sorted.filter(g => g.appid > cursor).slice(0, BATCH_SIZE);
  const total  = allOwned.length;

  if (batch.length === 0) {
    await (db as any).from('profiles')
      .update({ achievements_synced_at: new Date().toISOString() })
      .eq('id', profile.id);
    return json({ processed: total, total, nextCursor: null, done: true });
  }

  // Look up game_id for games already in the Chekpoint library.
  const batchAppids = batch.map(g => g.appid);
  const { data: statusRows } = await (db as any)
    .from('user_game_status')
    .select('game_id, steam_appid')
    .eq('profile_id', profile.id)
    .in('steam_appid', batchAppids);
  const gameIdByAppid = new Map<number, string>(
    (statusRows ?? []).map((r: any) => [r.steam_appid, r.game_id])
  );

  // Process games one at a time. Each game fires its 3 Steam API calls in
  // parallel (safe — one game at a time means max 3 concurrent requests).
  for (const { appid, name } of batch) {
    try {
      const [playerData, schemaData, globalData] = await Promise.all([
        fetchJson(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${steamApiKey}&steamid=${steamId}&l=en`),
        fetchJsonWithRetry(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&key=${steamApiKey}&l=en`),
        fetchJson(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`),
      ]);

      const playerAchs: any[] = playerData?.playerstats?.achievements ?? [];
      if (playerAchs.length === 0) continue; // no achievements or private stats for this game

      const schemaAchs: any[] = schemaData?.game?.availableGameStats?.achievements ?? [];
      const globalAchs: any[] = globalData?.achievementpercentages?.achievements ?? [];

      const schemaByName = new Map(schemaAchs.map((a: any) => [a.name, a]));
      const globalByName = new Map(globalAchs.map((a: any) => [a.name, a.percent]));

      const game_id = gameIdByAppid.get(appid) ?? null;
      const now     = new Date().toISOString();

      const rows = playerAchs.map((pa: any) => {
        const schema = schemaByName.get(pa.apiname) ?? {};
        const row: Record<string, unknown> = {
          profile_id:       profile.id,
          game_id,
          steam_appid:      appid,
          steam_game_title: name,
          api_name:         pa.apiname,
          display_name:     schema.displayName ?? pa.apiname,
          description:      schema.description ?? null,
          hidden:           schema.hidden === 1,
          unlocked:         pa.achieved === 1,
          unlock_time:      pa.achieved === 1 && pa.unlocktime
            ? new Date(pa.unlocktime * 1000).toISOString()
            : null,
          global_percent:   globalByName.get(pa.apiname) ?? null,
          synced_at:        now,
        };
        // Only include icon URLs when schema data was available. Omitting them
        // means ON CONFLICT DO UPDATE skips those columns, preserving previously
        // valid icon URLs when GetSchemaForGame is rate-limited or fails.
        if (schema.icongray) row.icon_gray_url = schema.icongray;
        // Fall back to icongray when icon is missing — Steam's client does the
        // same, so some achievements only have icongray set in the schema.
        const iconUrl = schema.icon || schema.icongray;
        if (iconUrl) row.icon_url = iconUrl;
        return row;
      });

      if (rows.length === 0) continue;

      // Unlocked achievements: full upsert including unlocked=true and unlock_time.
      // Locked achievements: metadata-only upsert — omit unlocked + unlock_time so
      // ON CONFLICT DO UPDATE only sets icon_url, display_name, etc. and never
      // touches the unlocked field. This means:
      //   - new rows get unlocked=false from the column DEFAULT
      //   - existing unlocked=true rows are never downgraded
      //   - existing rows with null icons get their icons repaired on every sync
      const unlockedRows = rows.filter(r => r.unlocked);
      const lockedRows   = rows.filter(r => !r.unlocked);

      if (unlockedRows.length > 0) {
        const { error } = await (db as any)
          .from('user_achievements')
          .upsert(unlockedRows, { onConflict: 'profile_id,steam_appid,api_name' });
        if (error) console.error(`[sync-achievements] unlocked upsert appid=${appid}:`, JSON.stringify(error));
      }
      if (lockedRows.length > 0) {
        // Strip unlocked + unlock_time — Supabase only SET columns present in the object
        const lockedMeta = lockedRows.map(({ unlocked: _u, unlock_time: _t, ...rest }: any) => rest);
        const { error } = await (db as any)
          .from('user_achievements')
          .upsert(lockedMeta, { onConflict: 'profile_id,steam_appid,api_name' });
        if (error) console.error(`[sync-achievements] locked upsert appid=${appid}:`, JSON.stringify(error));
      }
    } catch (e) {
      console.error(`[sync-achievements] error processing appid=${appid}:`, e);
    }
  }

  const lastAppid      = batch[batch.length - 1].appid;
  const processedCount = sorted.filter(g => g.appid <= lastAppid).length;
  const done           = batch.length < BATCH_SIZE;

  if (done) {
    await (db as any).from('profiles')
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
