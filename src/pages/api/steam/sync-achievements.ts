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

// Achievement-sync snapshot lifetime. If the cached owned-games list from
// GetOwnedGames is older than this on a resume, refetch — the user's library
// may have grown and we don't want to pretend it hasn't. A single sync session
// finishes in seconds to minutes, so this only matters for abandoned runs.
const SNAPSHOT_TTL_MS = 24 * 3600 * 1000;

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

// Steam's unlocktime is a unix-seconds int; 0 / missing means "unlocked but the
// timestamp was never recorded" (common for pre-2010 unlocks). Guard against
// garbage values that would make new Date().toISOString() throw.
function unlockedAt(pa: any): string | null {
  if (pa?.achieved !== 1) return null;
  const t = Number(pa.unlocktime);
  if (!Number.isFinite(t) || t <= 0) return null;
  const ms = t * 1000;
  if (ms > Date.now() + 86400000) return null; // implausible future date
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

// Upsert in chunks — a single game can carry thousands of achievement rows
// (asset-flip games), which risks request-size limits / very slow statements.
async function upsertChunked(
  db: any,
  table: string,
  rows: any[],
  onConflict: string,
  chunk = 500,
): Promise<any> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + chunk), { onConflict });
    if (error) return error;
  }
  return null;
}

// api_name -> stored row (icon only) for one profile+game. Used to skip
// re-writing locked achievement rows whose metadata hasn't changed. Paginated
// because a single game can exceed PostgREST's 1000-row default cap.
async function fetchStoredAchievements(
  db: any,
  profileId: string,
  appid: number,
): Promise<Map<string, { icon_url: string | null }>> {
  const out = new Map<string, { icon_url: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_achievements')
      .select('api_name, icon_url')
      .eq('profile_id', profileId)
      .eq('steam_appid', appid)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) out.set(r.api_name, { icon_url: r.icon_url ?? null });
    if (data.length < PAGE) break;
  }
  return out;
}

export const POST: APIRoute = async (context) => {
  const startedAt = Date.now();

  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));
  const force = body.force === true;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('steam_id, achievements_synced_at, achievements_sync_cursor, achievements_sync_snapshot')
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
  // resuming or continuing one that's already in flight. force=true skips it
  // (and also skips the delta filter below, for a full re-scan).
  const lastSync = profileData.achievements_synced_at;
  if (lastSync && isFreshStart && !force) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < 3600) {
      const mins = Math.ceil((3600 - secondsSince) / 60);
      return json({ error: `Achievements synced recently. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` }, 429);
    }
  }

  const steamId = profileData.steam_id as string;
  const steamApiKey = import.meta.env.STEAM_API_KEY;
  if (!steamApiKey) return json({ error: 'Steam API not configured.' }, 500);

  // The snapshot is the pre-filtered work queue for this sync session — the
  // owned games list already delta-trimmed. Reuse it across every batch so
  // GetOwnedGames only fires once per session instead of once per batch. On a
  // fresh start (cursor = 0), or when the snapshot is stale, or when force is
  // set, rebuild it from scratch.
  type SnapshotGame = { appid: number; name: string; rtime_last_played: number };
  type Snapshot = { started_at: string; games: SnapshotGame[]; total_owned: number };

  const existingSnapshot = profileData.achievements_sync_snapshot as Snapshot | null;
  const snapshotFresh = !!existingSnapshot?.started_at &&
    (Date.now() - new Date(existingSnapshot.started_at).getTime()) < SNAPSHOT_TTL_MS;
  const canReuseSnapshot = !isFreshStart && !force && snapshotFresh && Array.isArray(existingSnapshot?.games);

  let games: SnapshotGame[];
  let total: number; // count of games this sync will actually process (not full library)

  if (canReuseSnapshot) {
    games = existingSnapshot!.games;
    total = existingSnapshot!.total_owned ?? games.length;
  } else {
    // Fetch the full Steam library — the single flaky call we want to avoid
    // re-hitting on continuations. Retried since a transient failure here
    // would abort the whole sync.
    const ownedData = await fetchJsonWithRetry(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`,
      2,
      8000,
    );

    if (ownedData === null) {
      // Fetch actually failed (network / timeout / Steam-side error) after
      // retries — never a privacy issue. Cursor is preserved so the client's
      // retry picks up where it left off.
      const msg = isFreshStart
        ? 'Steam is temporarily unavailable. Try again in a minute.'
        : 'Steam is temporarily unavailable — your progress is saved, try again shortly.';
      return json({ error: msg }, 502);
    }

    const allOwned: Array<{ appid: number; name: string; rtime_last_played?: number }> =
      ownedData?.response?.games ?? [];

    if (allOwned.length === 0) {
      // Steam responded with a valid but empty list. That's either a private
      // profile or a genuinely empty library. Only blame privacy on fresh
      // starts — mid-sync we know reads have worked before, so blame Steam.
      const msg = isFreshStart
        ? 'Could not read your Steam library. Check that your Steam profile Game details are Public, then retry.'
        : 'Steam returned no games right now — your progress is saved, try again shortly.';
      return json({ error: msg }, 502);
    }

    // Delta filter: compare Steam's rtime_last_played PER GAME against our
    // last-polled time PER GAME (max synced_at from user_achievements). A game
    // is skipped only if we've polled it more recently than Steam thinks it
    // was last launched. Never-synced games (freshness undefined) always pass
    // so first-time schema pulls happen once per game. force bypasses the
    // whole filter for a full re-scan.
    //
    // This is strictly better than comparing to the profile-wide
    // achievements_synced_at: that marker moves forward on every completed
    // sync even if a particular game was silently skipped (Steam returned
    // null and the cursor advanced past it), leaving that game permanently
    // stuck as "already up to date" from the profile marker's point of view.
    const shouldDelta = !!lastSync && !force;

    const freshnessByAppid = new Map<number, number>(); // appid -> synced_at unix seconds
    if (shouldDelta) {
      const { data: syncedRows } = await (db as any)
        .rpc('steam_appid_last_synced', { p_profile_id: profile.id });
      for (const r of ((syncedRows as { steam_appid: number; last_synced_at: string }[] | null) ?? [])) {
        const secs = Math.floor(new Date(r.last_synced_at).getTime() / 1000);
        if (Number.isFinite(secs)) freshnessByAppid.set(r.steam_appid, secs);
      }
    }

    const filtered: SnapshotGame[] = allOwned
      .filter((g) => {
        if (!shouldDelta) return true;
        const gameFreshness = freshnessByAppid.get(g.appid);
        if (gameFreshness === undefined) return true; // never polled — include once
        // Steam usually returns rtime_last_played as an int, but coerce
        // defensively — the delta is silently wrong if a stringified number
        // sneaks through the > comparison as NaN.
        const rtime = Number(g.rtime_last_played) || 0;
        return rtime > gameFreshness;
      })
      .map((g) => ({ appid: g.appid, name: g.name, rtime_last_played: Number(g.rtime_last_played) || 0 }))
      .sort((a, b) => a.appid - b.appid);

    games = filtered;
    total = filtered.length;

    // Persist the snapshot so the next batch reuses it instead of re-hitting
    // Steam. Only relevant for multi-batch runs; a one-batch sync clears it
    // again a few lines below.
    await (db as any)
      .from('profiles')
      .update({
        achievements_sync_snapshot: {
          started_at: new Date().toISOString(),
          games: filtered,
          total_owned: allOwned.length,
        } satisfies Snapshot,
      })
      .eq('id', profile.id);
  }

  const remaining = games.filter((g) => g.appid > cursor);

  if (remaining.length === 0) {
    await (db as any)
      .from('profiles')
      .update({
        achievements_synced_at: new Date().toISOString(),
        achievements_sync_cursor: 0,
        achievements_sync_snapshot: null,
      })
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
  let playerHits = 0;   // games where Steam returned achievement data
  let playerNulls = 0;  // games where the player-achievements call failed outright
  const schemaUpserts: any[] = [];

  for (const { appid, name } of candidates) {
    // Always process at least one game; stop before the timeout after that.
    if (gamesProcessed > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;

    try {
      // Player achievements — always live (per-user, changes as they play).
      const playerData = await fetchJson(
        `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${steamApiKey}&steamid=${steamId}&l=en`,
      );
      if (playerData === null) playerNulls++; // 403 (privacy) or a transient failure

      // Dedupe by apiname — Steam occasionally returns the same achievement twice
      // in one game, which makes the whole ON CONFLICT upsert fail.
      const seenApi = new Set<string>();
      const playerAchs: any[] = (playerData?.playerstats?.achievements ?? []).filter((pa: any) => {
        if (!pa?.apiname || seenApi.has(pa.apiname)) return false;
        seenApi.add(pa.apiname);
        return true;
      });

      // Advance the cursor even for games with no achievements / private stats
      // so the next call never re-examines them.
      lastProcessedAppid = appid;
      gamesProcessed++;
      if (playerAchs.length === 0) continue;
      playerHits++;

      // Schema + global percents — cached per app across all users.
      const cached = schemaCache.get(appid);
      const stale =
        !cached || Date.now() - new Date(cached.fetched_at).getTime() > SCHEMA_TTL_MS;

      // Start from whatever the cache has; overlay fresh data if we fetch it.
      let schemaAchsArr: any[] = cached?.achievements ?? [];
      let globalPercents: Record<string, number> = cached?.global_percents ?? {};

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
        const freshSchema: any[] | null =
          schemaData?.game?.availableGameStats?.achievements ?? null;
        const freshGlobal: any[] | null =
          globalData?.achievementpercentages?.achievements ?? null;

        if (freshSchema && freshSchema.length > 0) schemaAchsArr = freshSchema;
        if (freshGlobal && freshGlobal.length > 0) {
          globalPercents = {};
          for (const g of freshGlobal) globalPercents[g.name] = g.percent;
        }

        // Persist ONLY when we actually got the achievement schema. Caching an
        // empty/failed fetch would suppress names + icons for the whole TTL;
        // instead leave the row absent (or stale) so the next sync retries.
        if (freshSchema && freshSchema.length > 0) {
          const row = {
            steam_appid: appid,
            achievements: schemaAchsArr,
            global_percents: globalPercents,
            fetched_at: new Date().toISOString(),
          };
          schemaCache.set(appid, row);
          schemaUpserts.push(row);
        }
      }

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
          unlock_time: unlockedAt(pa),
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
      //   - rows with a null icon get it repaired (see the locked-write filter
      //     below and the full rewrite whenever a fresh schema is fetched)
      const unlockedRows = rows.filter((r) => r.unlocked);
      const lockedRows = rows.filter((r) => !r.unlocked);

      if (unlockedRows.length > 0) {
        const error = await upsertChunked(db, 'user_achievements', unlockedRows, 'profile_id,steam_appid,api_name');
        if (error) console.error(`[sync-achievements] unlocked upsert appid=${appid}:`, JSON.stringify(error));
        else rowsSynced += unlockedRows.length;
      }
      if (lockedRows.length > 0) {
        // Re-writing every locked row on every pass churns tens of thousands of
        // dead tuples for nothing: when the schema came from a warm cache, the
        // metadata is byte-identical to what a prior sync already stored. When
        // we fetched a fresh schema this pass (`stale`), write them all — that's
        // the 30-day icon/percent refresh. Otherwise only write rows that are
        // missing from the roster or missing an icon we can now supply.
        let lockedToWrite = lockedRows;
        if (!stale) {
          const stored = await fetchStoredAchievements(db, profile.id, appid);
          lockedToWrite = lockedRows.filter((r) => {
            const ex = stored.get(r.api_name as string);
            if (!ex) return true;                          // new roster row
            if (!ex.icon_url && r.icon_url) return true;   // repair a missing icon
            return false;
          });
        }

        if (lockedToWrite.length > 0) {
          // Strip unlocked + unlock_time — Supabase only SETs columns present in the object
          const lockedMeta = lockedToWrite.map(({ unlocked: _u, unlock_time: _t, ...rest }: any) => rest);
          const error = await upsertChunked(db, 'user_achievements', lockedMeta, 'profile_id,steam_appid,api_name');
          if (error) console.error(`[sync-achievements] locked upsert appid=${appid}:`, JSON.stringify(error));
          else rowsSynced += lockedToWrite.length;
        }
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
  const processedCount = games.filter((g) => g.appid <= lastProcessedAppid).length;

  // A "single-batch total failure" is a fresh-start sync that finished in one
  // batch, tried to read some games, and wrote zero rows because every
  // GetPlayerAchievements call came back null. That's a Steam-side blip, not
  // a real sync — advancing achievements_synced_at would gate the user behind
  // the one-hour cooldown for a failure they didn't cause. Keep the old
  // marker so an immediate retry still gets through the cooldown gate. Games
  // that failed keep their old per-game freshness so the next sync's delta
  // still includes them.
  const singleBatchTotalFailure =
    done && isFreshStart && candidates.length > 0 && rowsSynced === 0 && playerNulls > 0;

  await (db as any)
    .from('profiles')
    .update(
      done
        ? (singleBatchTotalFailure
            ? {
                achievements_sync_cursor: 0,
                achievements_sync_snapshot: null,
              }
            : {
                achievements_synced_at: new Date().toISOString(),
                achievements_sync_cursor: 0,
                achievements_sync_snapshot: null,
              })
        : { achievements_sync_cursor: lastProcessedAppid },
    )
    .eq('id', profile.id);

  return json({
    processed: processedCount,
    total,
    syncedThisCall: rowsSynced,
    // Per-call diagnostics — the client accumulates these to detect a profile
    // whose "Game details" privacy is blocking every read.
    hitAchievements: playerHits,
    emptyResponses: playerNulls,
    // Whether this profile has ever completed a successful achievement sync.
    // The client uses this to decide whether it's safe to blame profile
    // privacy for an all-empty batch — if they've synced before, it's not
    // privacy, so we shouldn't lead with that.
    everSynced: !!lastSync,
    nextCursor: done ? null : lastProcessedAppid,
    done,
  });
};
