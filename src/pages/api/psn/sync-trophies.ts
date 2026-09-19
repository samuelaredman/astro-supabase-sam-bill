import type { APIRoute } from "astro";
import { requireAuth, json, type SupabaseAdmin } from "../../../utils/api";
import {
  getFreshAuth,
  isPsnAuthExpired,
  fetchAllTitles,
  fetchTitleTrophySchema,
  fetchEarnedTrophies,
  primaryPsnPlatform,
  type PsnTokens,
  type TrophyTitle,
  type AuthorizationPayload,
} from "../../../utils/psn";

// Netlify 10s timeout — stop processing titles at 7s and return the cursor.
// Client immediately calls back to continue. Same pattern as sync-achievements.
const TIME_BUDGET_MS = 7000;

// Hard ceiling on titles processed per call, independent of time budget. PSN
// trophy sets are smaller than Steam achievement lists on average, so we can
// process more per call.
const MAX_TITLES_PER_CALL = 25;

// Refetch a cached trophy schema after this long. Trophy metadata (icons,
// descriptions, rarity %) drifts slowly.
const SCHEMA_TTL_MS = 30 * 24 * 3600 * 1000;

// Session snapshot lifetime — reuse the pre-filtered work queue across all
// batches of one sync run. Only relevant when a sync spans multiple calls.
const SNAPSHOT_TTL_MS = 24 * 3600 * 1000;

const COOLDOWN_SECONDS = 60;

type SnapshotTitle = {
  npCommId: string;
  serviceName: 'trophy' | 'trophy2';
  platform: 'PS3' | 'PS4' | 'PS5';
  name: string;
  lastUpdated: string | null;
};
type Snapshot = { started_at: string; titles: SnapshotTitle[]; total_titles: number };

async function persistTokens(db: SupabaseAdmin, profileId: string, tokens: PsnTokens): Promise<void> {
  await (db as any).from('profiles').update({
    psn_access_token: tokens.access_token,
    psn_refresh_token: tokens.refresh_token,
    psn_token_expires_at: tokens.expires_at,
  }).eq('id', profileId);
}

// Upsert in chunks — a single title can carry hundreds of trophies (base game
// + DLC groups), and bulk inserts avoid PostgREST body-size issues.
async function upsertChunked(
  db: any,
  table: string,
  rows: any[],
  onConflict: string,
  chunkSize = 500,
): Promise<any> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + chunkSize), { onConflict });
    if (error) return error;
  }
  return null;
}

async function fetchStoredTrophies(
  db: any,
  profileId: string,
  npCommId: string,
): Promise<Map<string, { icon_url: string | null }>> {
  const out = new Map<string, { icon_url: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_trophies')
      .select('trophy_group_id, trophy_id, icon_url')
      .eq('profile_id', profileId)
      .eq('np_communication_id', npCommId)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) out.set(`${r.trophy_group_id}:${r.trophy_id}`, { icon_url: r.icon_url ?? null });
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
    .select(
      'psn_account_id, psn_access_token, psn_refresh_token, psn_token_expires_at, ' +
      'psn_trophies_synced_at, psn_sync_cursor, psn_sync_snapshot',
    )
    .eq('id', profile.id)
    .single();

  if (!profileData?.psn_account_id || !profileData.psn_refresh_token) {
    return json({ error: 'No PlayStation account connected.' }, 400);
  }

  // Cursor is a jsonb envelope: { npCommId } — the last npCommunicationId
  // fully processed. Explicit cursor from client wins over stored progress.
  const cursor: string | null =
    typeof body.cursor === 'string'
      ? body.cursor
      : (profileData.psn_sync_cursor as any)?.npCommId ?? null;
  const isFreshStart = !cursor;

  // Debounce on fresh starts only. Continuations skip the cooldown, and force
  // bypasses everything for a full re-scan.
  const lastSync = profileData.psn_trophies_synced_at;
  if (lastSync && isFreshStart && !force) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < COOLDOWN_SECONDS) {
      const wait = Math.max(1, Math.ceil(COOLDOWN_SECONDS - secondsSince));
      return json({ error: `Just synced — give it ${wait} second${wait !== 1 ? 's' : ''}.` }, 429);
    }
  }

  let authPayload: AuthorizationPayload;
  let tokens: PsnTokens;
  try {
    const fresh = await getFreshAuth({
      access_token: profileData.psn_access_token,
      refresh_token: profileData.psn_refresh_token,
      expires_at: profileData.psn_token_expires_at,
    });
    authPayload = fresh.auth;
    tokens = fresh.tokens;
    if (fresh.refreshed) await persistTokens(db, profile.id, tokens);
  } catch (e) {
    if (isPsnAuthExpired(e)) {
      return json({
        error: 'Your PlayStation connection expired. Reconnect by pasting a fresh NPSSO token.',
        needsReconnect: true,
      }, 401);
    }
    console.error('[psn/sync-trophies] token refresh error:', e);
    return json({ error: 'PlayStation is temporarily unavailable. Try again in a minute.' }, 502);
  }

  // Build or reuse the sync snapshot — the pre-filtered work queue for the
  // session. Fresh start / stale snapshot / force → rebuild from getUserTitles.
  const existingSnapshot = profileData.psn_sync_snapshot as Snapshot | null;
  const snapshotFresh =
    !!existingSnapshot?.started_at &&
    Date.now() - new Date(existingSnapshot.started_at).getTime() < SNAPSHOT_TTL_MS;
  const canReuseSnapshot =
    !isFreshStart && !force && snapshotFresh && Array.isArray(existingSnapshot?.titles);

  let titles: SnapshotTitle[];
  let total: number;

  if (canReuseSnapshot) {
    titles = existingSnapshot!.titles;
    total = existingSnapshot!.total_titles ?? titles.length;
  } else {
    let allTitles: TrophyTitle[];
    try {
      allTitles = await fetchAllTitles(authPayload, profileData.psn_account_id);
    } catch (e) {
      if (isPsnAuthExpired(e)) {
        return json({
          error: 'Your PlayStation connection expired. Reconnect by pasting a fresh NPSSO token.',
          needsReconnect: true,
        }, 401);
      }
      const msg = isFreshStart
        ? 'PlayStation is temporarily unavailable. Try again in a minute.'
        : 'PlayStation is temporarily unavailable — your progress is saved, try again shortly.';
      console.error('[psn/sync-trophies] getUserTitles error:', e);
      return json({ error: msg }, 502);
    }

    // Delta filter: on a resync, skip titles whose lastUpdatedDateTime hasn't
    // moved since our last sync. PSN's timestamp is reliable for this — it
    // advances on every trophy earn — unlike Steam's rtime_last_played.
    const shouldDelta = !!lastSync && !force;
    const lastSyncMs = lastSync ? new Date(lastSync).getTime() : 0;

    const filtered: SnapshotTitle[] = [];
    for (const t of allTitles) {
      const platform = primaryPsnPlatform(t.trophyTitlePlatform);
      if (!platform) continue;
      if (shouldDelta && t.lastUpdatedDateTime) {
        const updatedMs = new Date(t.lastUpdatedDateTime).getTime();
        if (Number.isFinite(updatedMs) && updatedMs <= lastSyncMs) continue;
      }
      filtered.push({
        npCommId: t.npCommunicationId,
        serviceName: t.npServiceName,
        platform,
        name: t.trophyTitleName ?? '',
        lastUpdated: t.lastUpdatedDateTime ?? null,
      });
    }
    // Deterministic ordering so the string cursor is monotonic.
    filtered.sort((a, b) => a.npCommId.localeCompare(b.npCommId));

    titles = filtered;
    total = filtered.length;

    await (db as any)
      .from('profiles')
      .update({
        psn_sync_snapshot: {
          started_at: new Date().toISOString(),
          titles: filtered,
          total_titles: allTitles.length,
        } satisfies Snapshot,
      })
      .eq('id', profile.id);
  }

  const remaining = cursor
    ? titles.filter((t) => t.npCommId > cursor)
    : titles;

  if (remaining.length === 0) {
    await (db as any).from('profiles').update({
      psn_trophies_synced_at: new Date().toISOString(),
      psn_sync_cursor: null,
      psn_sync_snapshot: null,
    }).eq('id', profile.id);
    return json({ processed: total, total, syncedThisCall: 0, nextCursor: null, done: true });
  }

  const candidates = remaining.slice(0, MAX_TITLES_PER_CALL);
  const candidateIds = candidates.map((c) => c.npCommId);

  // Load cached schemas for this batch.
  const { data: cacheRows } = await (db as any)
    .from('psn_title_schema')
    .select('np_communication_id, trophies, no_trophies, fetched_at')
    .in('np_communication_id', candidateIds);
  const schemaCache = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.np_communication_id, r]));

  // game_id lookups for candidates already in the user's library — populated
  // by sync-library.
  const { data: statusRows } = await (db as any)
    .from('user_game_status')
    .select('game_id, psn_np_communication_id')
    .eq('profile_id', profile.id)
    .in('psn_np_communication_id', candidateIds);
  const gameIdByNpComm = new Map<string, string>(
    (statusRows ?? []).map((r: any) => [r.psn_np_communication_id, r.game_id]),
  );

  let lastProcessedId = cursor ?? '';
  let titlesProcessed = 0;
  let rowsSynced = 0;
  let trophyHits = 0;
  let trophyNulls = 0;
  const schemaUpserts: any[] = [];
  const noTrophyUpserts: any[] = [];

  for (const t of candidates) {
    // Always process at least one; stop before the timeout after that.
    if (titlesProcessed > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;

    // Cached no-trophies verdict — skip Sony call entirely.
    if (schemaCache.get(t.npCommId)?.no_trophies === true) {
      lastProcessedId = t.npCommId;
      titlesProcessed++;
      continue;
    }

    try {
      const earned = await fetchEarnedTrophies(
        authPayload,
        profileData.psn_account_id,
        t.npCommId,
        t.serviceName,
      );

      if (earned === null) {
        trophyNulls++;
        // Still advance so a persistent per-title failure can't wedge sync.
        lastProcessedId = t.npCommId;
        titlesProcessed++;
        continue;
      }

      if (earned.length === 0) {
        // Sony confirmed the title has no trophies. Cache the verdict.
        noTrophyUpserts.push({
          np_communication_id: t.npCommId,
          np_service_name: t.serviceName,
          no_trophies: true,
          fetched_at: new Date().toISOString(),
        });
        lastProcessedId = t.npCommId;
        titlesProcessed++;
        continue;
      }

      trophyHits++;

      // Schema (names, descriptions, icons, rarity) is per-title, cached
      // across users. Only fetch when missing or stale.
      const cached = schemaCache.get(t.npCommId);
      const stale = !cached || Date.now() - new Date(cached.fetched_at).getTime() > SCHEMA_TTL_MS;

      let schemaArr: any[] = cached?.trophies ?? [];

      if (stale) {
        const fresh = await fetchTitleTrophySchema(authPayload, t.npCommId, t.serviceName);
        if (fresh && fresh.length > 0) {
          schemaArr = fresh;
          const row = {
            np_communication_id: t.npCommId,
            np_service_name: t.serviceName,
            trophies: fresh,
            fetched_at: new Date().toISOString(),
          };
          schemaCache.set(t.npCommId, row);
          schemaUpserts.push(row);
        }
      }

      // Trophy schema is keyed by (trophyGroupId, trophyId). Missing
      // trophyGroupId defaults to 'default' — some old titles return a null.
      const schemaByKey = new Map<string, any>();
      for (const s of schemaArr) {
        const gid = s.trophyGroupId ?? 'default';
        schemaByKey.set(`${gid}:${s.trophyId}`, s);
      }

      const game_id = gameIdByNpComm.get(t.npCommId) ?? null;
      const now = new Date().toISOString();

      const rows = earned.map((ut) => {
        // Earned response includes trophyGroupId when the request used "all";
        // fall back to schema's group for safety.
        const gid = (ut as any).trophyGroupId ?? schemaByKey.get(`default:${ut.trophyId}`)?.trophyGroupId ?? 'default';
        const schema = schemaByKey.get(`${gid}:${ut.trophyId}`) ?? {};
        const earnedRate = typeof ut.trophyEarnedRate === 'string'
          ? Number(ut.trophyEarnedRate)
          : (ut.trophyEarnedRate ?? null);

        const row: Record<string, unknown> = {
          profile_id: profile.id,
          game_id,
          np_communication_id: t.npCommId,
          np_service_name: t.serviceName,
          trophy_group_id: gid,
          trophy_id: ut.trophyId,
          trophy_type: ut.trophyType,
          psn_platform: t.platform,
          psn_game_title: t.name,
          hidden: ut.trophyHidden === true,
          earned: ut.earned === true,
          earned_at: ut.earned === true ? ut.earnedDateTime ?? null : null,
          earned_rate: Number.isFinite(earnedRate as number) ? earnedRate : null,
          synced_at: now,
        };
        if (schema.trophyName) row.name = schema.trophyName;
        if (schema.trophyDetail) row.description = schema.trophyDetail;
        if (schema.trophyIconUrl) row.icon_url = schema.trophyIconUrl;
        return row;
      });

      if (rows.length === 0) {
        lastProcessedId = t.npCommId;
        titlesProcessed++;
        continue;
      }

      // Split earned vs locked — mirrors the Steam pattern. Earned rows fully
      // upsert (including earned=true + earned_at); locked rows omit those
      // columns so ON CONFLICT DO UPDATE never downgrades a previously earned
      // trophy back to locked, and only writes metadata deltas.
      const earnedRows = rows.filter((r) => r.earned === true);
      const lockedRows = rows.filter((r) => r.earned !== true);

      if (earnedRows.length > 0) {
        const err = await upsertChunked(
          db,
          'user_trophies',
          earnedRows,
          'profile_id,np_communication_id,trophy_group_id,trophy_id',
        );
        if (err) console.error(`[psn/sync-trophies] earned upsert ${t.npCommId}:`, JSON.stringify(err));
        else rowsSynced += earnedRows.length;
      }

      if (lockedRows.length > 0) {
        // Same dead-tuple optimization as sync-achievements — only rewrite
        // locked rows on the schema-refresh path or when metadata is missing.
        let lockedToWrite = lockedRows;
        if (!stale) {
          const stored = await fetchStoredTrophies(db, profile.id, t.npCommId);
          lockedToWrite = lockedRows.filter((r) => {
            const key = `${r.trophy_group_id}:${r.trophy_id}`;
            const ex = stored.get(key);
            if (!ex) return true;
            if (!ex.icon_url && r.icon_url) return true;
            return false;
          });
        }

        if (lockedToWrite.length > 0) {
          const lockedMeta = lockedToWrite.map(({ earned: _e, earned_at: _t, ...rest }: any) => rest);
          const err = await upsertChunked(
            db,
            'user_trophies',
            lockedMeta,
            'profile_id,np_communication_id,trophy_group_id,trophy_id',
          );
          if (err) console.error(`[psn/sync-trophies] locked upsert ${t.npCommId}:`, JSON.stringify(err));
          else rowsSynced += lockedToWrite.length;
        }
      }

      lastProcessedId = t.npCommId;
      titlesProcessed++;
    } catch (e) {
      if (isPsnAuthExpired(e)) {
        return json({
          error: 'Your PlayStation connection expired. Reconnect by pasting a fresh NPSSO token.',
          needsReconnect: true,
        }, 401);
      }
      console.error(`[psn/sync-trophies] error processing ${t.npCommId}:`, e);
      lastProcessedId = t.npCommId;
      titlesProcessed++;
    }
  }

  if (schemaUpserts.length > 0) {
    const { error } = await (db as any)
      .from('psn_title_schema')
      .upsert(schemaUpserts, { onConflict: 'np_communication_id' });
    if (error) console.error('[psn/sync-trophies] schema cache upsert:', JSON.stringify(error));
  }
  if (noTrophyUpserts.length > 0) {
    const { error } = await (db as any)
      .from('psn_title_schema')
      .upsert(noTrophyUpserts, { onConflict: 'np_communication_id' });
    if (error) console.error('[psn/sync-trophies] no-trophies cache upsert:', JSON.stringify(error));
  }

  const done = remaining.filter((t) => t.npCommId > lastProcessedId).length === 0;
  const processedCount = titles.filter((t) => t.npCommId <= lastProcessedId).length;

  // Single-batch total failure: fresh-start run finished in one call, tried
  // titles, wrote zero rows because every earned call returned null. Keep the
  // old marker so an immediate retry gets through the cooldown, same as Steam.
  const singleBatchTotalFailure =
    done && isFreshStart && candidates.length > 0 && rowsSynced === 0 && trophyNulls > 0;

  await (db as any)
    .from('profiles')
    .update(
      done
        ? (singleBatchTotalFailure
            ? { psn_sync_cursor: null, psn_sync_snapshot: null }
            : {
                psn_trophies_synced_at: new Date().toISOString(),
                psn_sync_cursor: null,
                psn_sync_snapshot: null,
              })
        : { psn_sync_cursor: { npCommId: lastProcessedId } },
    )
    .eq('id', profile.id);

  return json({
    processed: processedCount,
    total,
    syncedThisCall: rowsSynced,
    hitTrophies: trophyHits,
    emptyResponses: trophyNulls,
    everSynced: !!lastSync,
    nextCursor: done ? null : lastProcessedId,
    done,
  });
};
