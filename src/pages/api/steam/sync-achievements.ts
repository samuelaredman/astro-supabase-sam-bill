import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const BATCH_SIZE = 15; // games per call — keeps function well under 10s timeout
const CONCURRENCY = 5; // parallel game fetches within a batch

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
  const cursor: number = body.cursor ?? 0; // steam_appid to start after (for pagination)

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('steam_id, achievements_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.steam_id) {
    return json({ error: 'No Steam account connected.' }, 400);
  }

  // 1-hour cooldown — achievement data changes slowly
  const lastSync = (profileData as any).achievements_synced_at;
  if (lastSync && body.cursor == null) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < 3600) {
      const mins = Math.ceil((3600 - secondsSince) / 60);
      return json({ error: `Please wait ${mins} minute${mins !== 1 ? 's' : ''} before syncing again.` }, 429);
    }
  }

  const steamId    = profileData.steam_id as string;
  const steamApiKey = import.meta.env.STEAM_API_KEY;
  if (!steamApiKey) return json({ error: 'Steam API not configured.' }, 500);

  // Fetch the list of games we have steam_appids for
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

  const games: Array<{ game_id: string; steam_appid: number }> = gameRows ?? [];

  // Also get total count for progress reporting
  const { count: totalCount } = await (db as any)
    .from('user_game_status')
    .select('steam_appid', { count: 'exact', head: true })
    .eq('profile_id', profile.id)
    .not('steam_appid', 'is', null);

  if (games.length === 0) {
    return json({ processed: 0, total: totalCount ?? 0, done: true });
  }

  let processed = 0;
  let lastAppid = cursor;

  // Process games in parallel groups
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
        if (playerAchs.length === 0) {
          // Game has no achievements or profile is private for this game — skip
          processed++;
          lastAppid = appid;
          return;
        }

        const schemaAchs: any[] = schemaData?.game?.availableGameStats?.achievements ?? [];
        const globalAchs: any[] = globalData?.achievementpercentages?.achievements ?? [];

        // Build lookup maps
        const schemaByName = new Map(schemaAchs.map((a: any) => [a.name, a]));
        const globalByName = new Map(globalAchs.map((a: any) => [a.name, a.percent]));

        const rows = playerAchs.map((pa: any) => {
          const schema = schemaByName.get(pa.apiname) ?? {};
          return {
            profile_id:    profile.id,
            game_id:       game_id || null,
            steam_appid:   appid,
            api_name:      pa.apiname,
            display_name:  schema.displayName ?? pa.apiname,
            description:   schema.description ?? null,
            icon_url:      schema.icon ?? null,
            icon_gray_url: schema.icongray ?? null,
            hidden:        schema.hidden === 1,
            unlocked:      pa.achieved === 1,
            unlock_time:   pa.achieved === 1 && pa.unlocktime
              ? new Date(pa.unlocktime * 1000).toISOString()
              : null,
            global_percent: globalByName.get(pa.apiname) ?? null,
            synced_at:     new Date().toISOString(),
          };
        });

        if (rows.length === 0) {
          processed++;
          lastAppid = appid;
          return;
        }

        const { error: upsertErr } = await (db as any)
          .from('user_achievements')
          .upsert(rows, { onConflict: 'profile_id,steam_appid,api_name' });

        if (upsertErr) {
          console.error(`[sync-achievements] upsert error appid=${appid}:`, JSON.stringify(upsertErr));
        }

        processed++;
        lastAppid = appid;
      } catch (e) {
        console.error(`[sync-achievements] error processing appid=${appid}:`, e);
        processed++;
        lastAppid = appid;
      }
    }));
  }

  const done = games.length < BATCH_SIZE;

  // Stamp completion time on the final batch so the cooldown can kick in
  if (done) {
    await (db as any)
      .from('profiles')
      .update({ achievements_synced_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  return json({
    processed,
    total: totalCount ?? 0,
    nextCursor: done ? null : lastAppid,
    done,
  });
};
