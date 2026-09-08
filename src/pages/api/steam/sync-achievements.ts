import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// Netlify synchronous functions time out at 10s. Stop processing games once
// we've spent this long and return partial progress — the client immediately
// calls back with the cursor to continue. This is what keeps a large library
// (thousands of achievements) from failing: every call finishes cleanly.
const TIME_BUDGET_MS = 7000;

// Hard ceiling on games inspected per call, independent of the time budget.
const MAX_GAMES_PER_CALL = 40;

// Re-fetch a cached app schema after this long. Achievement metadata rarely
// changes; global unlock percentages drift slowly.
const SCHEMA_TTL_MS = 30 * 24 * 3600 * 1000;

// Steam's GetSchemaForGame returns icon hashes that only reliably resolve on
// shared.fastly.steamstatic.com/community_assets/. The old steamcdn-a.akamaihd.net
// CDN is stale for many achievements. Always extract the filename and rewrite
// to the new CDN regardless of what format the schema returns (full URL or bare hash).
function steamIconUrl(icon: string | null | undefined, appid: number): string | null {
  if (!icon) return null;
  const filename = icon.split('/').pop();
  if (!filename) return null;
  return `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appid}/${filename}`;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null; // timeout / network error — caller decides how to degrade
  }
}

// Retry a few times with a short backoff — used for the endpoints that share a
// stricter per-key rate limit (owned games, schema).
async function fetchJsonWithRetry(url: string, retries = 1, timeoutMs = 6000): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500 * i));
    const result = await fetchJson(url, timeoutMs);
    if (result !== null) return result;
  }
  return null;
}

export const POST: APIRoute = async (context) => {
  const startedAt = Date.now();

  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('steam_id, achievements_synced_at, achievements_sync_cursor')
    .eq('id', profile.id)
    .single();

  if (!profileData?.steam_id) {
    return json({ error: 'No Steam account connected.' }, 400);
  }

  // Explicit cursor from the client wins; otherwise resume from stored progress.
  const cursor: number =
    typeof body.cursor === 'number'
      ? body.cursor
      : Number(profileData.achievements_sync_cursor ?? 0) || 0;
  const isFreshStart = cursor === 0;

  // 1-hour cooldown applies only to starting a brand-new sync — never to
  // resuming or continuing one that's already in flight.
  const lastSync = profileData.achievements_synced_at;
  if (lastSync && isFreshStart && body.force !== true) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < 3600) {
      const mins = Math.ceil((3600 - secondsSince) / 60);
      return json({ error: `Achievements synced recently. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` }, 429);
    }
  }

  const steamId = profileData.steam_id as string;
  const steamApiKey = import.meta.env.STEAM_API_KEY;
  if (!steamApiKey) return json({ error: 'Steam API not configured.' }, 500);

  // Full Steam library — one call, retried since a transient failure here would
  // otherwise abort the whole sync.
  const ownedData = await fetchJsonWithRetry(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`,
    2,
    8000,
  );
  const allOwned: Array<{ appid: number; name: string }> = ownedData?.response?.games ?? [];

  if (allOwned.length === 0) {
    // Transient Steam issue or a private profile — 502 so the client retries
    // without wiping the progress cursor.
    return json({ error: 'Could not read your Steam library right now. Check that your Steam profile Game Details are Public, then retry.' }, 502);
  }

  const sorted = [...allOwned].sort((a, b) => a.appid - b.appid);
  const remaining = sorted.filter((g) => g.appid > cursor);
  const total = allOwned.length;

  if (remaining.length === 0) {
    await (db as any)
      .from('profiles')
      .update({ achievements_synced_at: new Date().toISOString(), achievements_sync_cursor: 0 })
      .eq('id', profile.id);
    return json({ processed: total, total, syncedThisCall: 0, nextCursor: null, done: true });
  }

  const candidates = remaining.slice(0, MAX_GAMES_PER_CALL);
  const candidateAppids = candidates.map((g) => g.appid);

  // Cached schemas for this call's candidate apps (one query, bounded set).
  const { data: cacheRows } = await (db as any)
    .from('steam_app_schema')
    .select('steam_appid, achievements, global_percents, fetched_at')
    .in('steam_appid', candidateAppids);
  const schemaCache = new Map<number, any>((cacheRows ?? []).map((r: any) => [r.steam_appid, r]));

  // game_id for candidates already in the Chekpoint library.
  const { data: statusRows } = await (db as any)
    .from('user_game_status')
    .select('game_id, steam_appid')
    .eq('profile_id', profile.id)
    .in('steam_appid', candidateAppids);
  const gameIdByAppid = new Map<number, string>(
    (statusRows ?? []).map((r: any) => [r.steam_appid, r.game_id]),
  );

  let lastProcessedAppid = cursor;
  let gamesProcessed = 0;
  let rowsSynced = 0;
  const schemaUpserts: any[] = [];

  for (const { appid, name } of candidates) {
    // Always process at least one game; stop before the timeout after that.
    if (gamesProcessed > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;

    try {
      // Player achievements — always live (per-user, changes as they play).
      const playerData = await fetchJson(
        `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${steamApiKey}&steamid=${steamId}&l=en`,
      );
      const playerAchs: any[] = playerData?.playerstats?.achievements ?? [];

      // Advance the cursor even for games with no achievements / private stats
      // so the next call never re-examines them.
      lastProcessedAppid = appid;
      gamesProcessed++;
      if (playerAchs.length === 0) continue;

      // Schema + global percents — cached per app across all users.
      let cached = schemaCache.get(appid);
      const stale =
        !cached || Date.now() - new Date(cached.fetched_at).getTime() > SCHEMA_TTL_MS;
      if (stale) {
        const [schemaData, globalData] = await Promise.all([
          fetchJsonWithRetry(
            `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid=${appid}&key=${steamApiKey}&l=en`,
            1,
            6000,
          ),
          fetchJson(
            `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`,
            6000,
          ),
        ]);
        const schemaAchs: any[] | null =
          schemaData?.game?.availableGameStats?.achievements ?? null;
        const globalAchs: any[] | null =
          globalData?.achievementpercentages?.achievements ?? null;

        if (schemaAchs || globalAchs) {
          const gp: Record<string, number> = {};
          for (const g of globalAchs ?? []) gp[g.name] = g.percent;
          cached = {
            steam_appid: appid,
            achievements: schemaAchs ?? cached?.achievements ?? [],
            global_percents: globalAchs ? gp : cached?.global_percents ?? {},
            fetched_at: new Date().toISOString(),
          };
          schemaCache.set(appid, cached);
          schemaUpserts.push(cached);
        }
      }

      const schemaAchsArr: any[] = cached?.achievements ?? [];
      const globalPercents: Record<string, number> = cached?.global_percents ?? {};
      const schemaByName = new Map(schemaAchsArr.map((a: any) => [a.name, a]));

      const game_id = gameIdByAppid.get(appid) ?? null;
      const now = new Date().toISOString();

      const rows = playerAchs.map((pa: any) => {
        const schema: any = schemaByName.get(pa.apiname) ?? {};
        const row: Record<string, unknown> = {
          profile_id: profile.id,
          game_id,
          steam_appid: appid,
          steam_game_title: name,
          api_name: pa.apiname,
          display_name: schema.displayName ?? pa.apiname,
          description: schema.description ?? null,
          hidden: schema.hidden === 1,
          unlocked: pa.achieved === 1,
          unlock_time:
            pa.achieved === 1 && pa.unlocktime
              ? new Date(pa.unlocktime * 1000).toISOString()
              : null,
          global_percent: globalPercents[pa.apiname] ?? null,
          synced_at: now,
        };
        // Only include icon URLs when schema data was available. Omitting them
        // means ON CONFLICT DO UPDATE skips those columns, preserving previously
        // valid icon URLs when GetSchemaForGame is rate-limited or fails.
        const iconUrl = steamIconUrl(schema.icon || schema.icongray, appid);
        const iconGrayUrl = steamIconUrl(schema.icongray, appid);
        if (iconUrl) row.icon_url = iconUrl;
        if (iconGrayUrl) row.icon_gray_url = iconGrayUrl;
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
      const unlockedRows = rows.filter((r) => r.unlocked);
      const lockedRows = rows.filter((r) => !r.unlocked);

      if (unlockedRows.length > 0) {
        const { error } = await (db as any)
          .from('user_achievements')
          .upsert(unlockedRows, { onConflict: 'profile_id,steam_appid,api_name' });
        if (error) console.error(`[sync-achievements] unlocked upsert appid=${appid}:`, JSON.stringify(error));
        else rowsSynced += unlockedRows.length;
      }
      if (lockedRows.length > 0) {
        // Strip unlocked + unlock_time — Supabase only SETs columns present in the object
        const lockedMeta = lockedRows.map(({ unlocked: _u, unlock_time: _t, ...rest }: any) => rest);
        const { error } = await (db as any)
          .from('user_achievements')
          .upsert(lockedMeta, { onConflict: 'profile_id,steam_appid,api_name' });
        if (error) console.error(`[sync-achievements] locked upsert appid=${appid}:`, JSON.stringify(error));
        else rowsSynced += lockedRows.length;
      }
    } catch (e) {
      console.error(`[sync-achievements] error processing appid=${appid}:`, e);
      // Still advance past a game that blew up so it can't wedge the whole sync.
      lastProcessedAppid = appid;
      gamesProcessed++;
    }
  }

  // Persist the freshly fetched schemas for everyone's future syncs.
  if (schemaUpserts.length > 0) {
    const { error } = await (db as any)
      .from('steam_app_schema')
      .upsert(schemaUpserts, { onConflict: 'steam_appid' });
    if (error) console.error('[sync-achievements] schema cache upsert:', JSON.stringify(error));
  }

  const done = remaining.filter((g) => g.appid > lastProcessedAppid).length === 0;
  const processedCount = sorted.filter((g) => g.appid <= lastProcessedAppid).length;

  await (db as any)
    .from('profiles')
    .update(
      done
        ? { achievements_synced_at: new Date().toISOString(), achievements_sync_cursor: 0 }
        : { achievements_sync_cursor: lastProcessedAppid },
    )
    .eq('id', profile.id);

  return json({
    processed: processedCount,
    total,
    syncedThisCall: rowsSynced,
    nextCursor: done ? null : lastProcessedAppid,
    done,
  });
};
