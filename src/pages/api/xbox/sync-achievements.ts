import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import {
  fetchAllTitles,
  fetchAchievementsForTitle,
  isXboxAuthInvalid,
  type XboxTitleSummary,
} from "../../../utils/xbox";

// Netlify 10s timeout — same 7s work budget as sync-achievements /
// sync-trophies. Client loops the endpoint until done:true.
const TIME_BUDGET_MS = 7000;

// Xbox per-title responses are typically small (10-50 achievements) so we
// can process more per batch than PSN's 25.
const MAX_TITLES_PER_CALL = 40;

const SCHEMA_TTL_MS = 30 * 24 * 3600 * 1000;
const SNAPSHOT_TTL_MS = 24 * 3600 * 1000;
const COOLDOWN_SECONDS = 60;

type SnapshotTitle = {
  titleId: string;
  name: string;
  currentAchievements: number;
  totalAchievements: number;
  lastPlayed: string | null;
};
type Snapshot = { started_at: string; titles: SnapshotTitle[]; total_titles: number };

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

async function fetchStoredAchievements(
  db: any,
  profileId: string,
  titleId: string,
): Promise<Map<string, { icon_url: string | null }>> {
  const out = new Map<string, { icon_url: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_xbox_achievements')
      .select('achievement_id, icon_url')
      .eq('profile_id', profileId)
      .eq('xbox_title_id', titleId)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) out.set(r.achievement_id, { icon_url: r.icon_url ?? null });
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
      'xbox_xuid, xbox_api_key, xbox_achievements_synced_at, ' +
      'xbox_sync_cursor, xbox_sync_snapshot',
    )
    .eq('id', profile.id)
    .single();

  if (!profileData?.xbox_xuid || !profileData?.xbox_api_key) {
    return json({ error: 'No Xbox account connected.' }, 400);
  }

  // Cursor is a jsonb envelope: { titleId } — the last titleId fully
  // processed. Explicit cursor from client wins over stored progress.
  const cursor: string | null =
    typeof body.cursor === 'string'
      ? body.cursor
      : (profileData.xbox_sync_cursor as any)?.titleId ?? null;
  const isFreshStart = !cursor;

  const lastSync = profileData.xbox_achievements_synced_at;
  if (lastSync && isFreshStart && !force) {
    const secondsSince = (Date.now() - new Date(lastSync).getTime()) / 1000;
    if (secondsSince < COOLDOWN_SECONDS) {
      const wait = Math.max(1, Math.ceil(COOLDOWN_SECONDS - secondsSince));
      return json({ error: `Just synced — give it ${wait} second${wait !== 1 ? 's' : ''}.` }, 429);
    }
  }

  const apiKey = profileData.xbox_api_key as string;
  const xuid = profileData.xbox_xuid as string;

  // Build or reuse the sync snapshot.
  const existingSnapshot = profileData.xbox_sync_snapshot as Snapshot | null;
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
    let allTitles: XboxTitleSummary[];
    try {
      allTitles = await fetchAllTitles(apiKey, xuid);
    } catch (e) {
      if (isXboxAuthInvalid(e)) {
        return json({
          error: 'Your Xbox API key is no longer valid. Reconnect from Settings.',
          needsReconnect: true,
        }, 401);
      }
      console.error('[xbox/sync-achievements] fetchAllTitles error:', e);
      const msg = isFreshStart
        ? 'Xbox Live is temporarily unavailable. Try again in a minute.'
        : 'Xbox Live is temporarily unavailable — your progress is saved, try again shortly.';
      return json({ error: msg }, 502);
    }

    // Delta filter: on a resync, skip titles where the user has ALREADY
    // earned every achievement (currentAchievements === totalAchievements)
    // AND the schema hasn't been refreshed recently. Xbox's titleHistory
    // gives us current/total counts up-front — cheaper delta than pulling
    // the per-title achievement list to compare.
    //
    // Also skip titles with 0 total achievements (apps).
    const shouldDelta = !!lastSync && !force;

    const filtered: SnapshotTitle[] = [];
    for (const t of allTitles) {
      if (t.totalAchievements === 0) continue;
      if (shouldDelta && t.currentAchievements === 0 && !t.lastPlayed) continue;
      filtered.push({
        titleId: t.titleId,
        name: t.name,
        currentAchievements: t.currentAchievements,
        totalAchievements: t.totalAchievements,
        lastPlayed: t.lastPlayed,
      });
    }
    filtered.sort((a, b) => a.titleId.localeCompare(b.titleId));

    titles = filtered;
    total = filtered.length;

    await (db as any)
      .from('profiles')
      .update({
        xbox_sync_snapshot: {
          started_at: new Date().toISOString(),
          titles: filtered,
          total_titles: allTitles.length,
        } satisfies Snapshot,
      })
      .eq('id', profile.id);
  }

  const remaining = cursor
    ? titles.filter((t) => t.titleId > cursor)
    : titles;

  if (remaining.length === 0) {
    await (db as any).from('profiles').update({
      xbox_achievements_synced_at: new Date().toISOString(),
      xbox_sync_cursor: null,
      xbox_sync_snapshot: null,
    }).eq('id', profile.id);
    return json({ processed: total, total, syncedThisCall: 0, nextCursor: null, done: true });
  }

  const candidates = remaining.slice(0, MAX_TITLES_PER_CALL);
  const candidateIds = candidates.map((c) => c.titleId);

  const { data: cacheRows } = await (db as any)
    .from('xbox_title_schema')
    .select('xbox_title_id, achievements, no_achievements, fetched_at')
    .in('xbox_title_id', candidateIds);
  const schemaCache = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.xbox_title_id, r]));

  const { data: statusRows } = await (db as any)
    .from('user_game_status')
    .select('game_id, xbox_title_id')
    .eq('profile_id', profile.id)
    .in('xbox_title_id', candidateIds);
  const gameIdByTitleId = new Map<string, string>(
    (statusRows ?? []).map((r: any) => [r.xbox_title_id, r.game_id]),
  );

  let lastProcessedId = cursor ?? '';
  let titlesProcessed = 0;
  let rowsSynced = 0;
  let achievementHits = 0;
  let achievementNulls = 0;
  const schemaUpserts: any[] = [];
  const noStatsUpserts: any[] = [];

  for (const t of candidates) {
    if (titlesProcessed > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;

    if (schemaCache.get(t.titleId)?.no_achievements === true) {
      lastProcessedId = t.titleId;
      titlesProcessed++;
      continue;
    }

    try {
      const achievements = await fetchAchievementsForTitle(apiKey, xuid, t.titleId);

      if (achievements === null) {
        achievementNulls++;
        lastProcessedId = t.titleId;
        titlesProcessed++;
        continue;
      }

      if (achievements.length === 0) {
        noStatsUpserts.push({
          xbox_title_id: t.titleId,
          no_achievements: true,
          fetched_at: new Date().toISOString(),
        });
        lastProcessedId = t.titleId;
        titlesProcessed++;
        continue;
      }

      achievementHits++;

      const cached = schemaCache.get(t.titleId);
      const stale = !cached || Date.now() - new Date(cached.fetched_at).getTime() > SCHEMA_TTL_MS;

      if (stale) {
        const schemaRows = achievements.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          icon_url: a.iconUrl,
          gamerscore: a.gamerscore,
          rarity: a.rarity,
        }));
        const row = {
          xbox_title_id: t.titleId,
          achievements: schemaRows,
          fetched_at: new Date().toISOString(),
        };
        schemaCache.set(t.titleId, row);
        schemaUpserts.push(row);
      }

      const game_id = gameIdByTitleId.get(t.titleId) ?? null;
      const now = new Date().toISOString();

      const rows = achievements.map((a) => {
        const row: Record<string, unknown> = {
          profile_id: profile.id,
          game_id,
          xbox_title_id: t.titleId,
          xbox_game_title: t.name,
          achievement_id: a.id,
          name: a.name,
          description: a.description,
          gamerscore: a.gamerscore,
          rarity: a.rarity,
          unlocked: a.unlocked,
          unlocked_at: a.unlockedAt,
          synced_at: now,
        };
        if (a.iconUrl) row.icon_url = a.iconUrl;
        return row;
      });

      if (rows.length === 0) {
        lastProcessedId = t.titleId;
        titlesProcessed++;
        continue;
      }

      // Split earned vs locked — mirrors Steam / PSN. Earned rows fully
      // upsert (including unlocked=true + unlocked_at); locked rows omit
      // those columns so ON CONFLICT DO UPDATE never downgrades a
      // previously earned achievement, and only writes metadata deltas.
      const earnedRows = rows.filter((r) => r.unlocked === true);
      const lockedRows = rows.filter((r) => r.unlocked !== true);

      if (earnedRows.length > 0) {
        const err = await upsertChunked(
          db,
          'user_xbox_achievements',
          earnedRows,
          'profile_id,xbox_title_id,achievement_id',
        );
        if (err) console.error(`[xbox/sync-achievements] earned upsert ${t.titleId}:`, JSON.stringify(err));
        else rowsSynced += earnedRows.length;
      }

      if (lockedRows.length > 0) {
        let lockedToWrite = lockedRows;
        if (!stale) {
          const stored = await fetchStoredAchievements(db, profile.id, t.titleId);
          lockedToWrite = lockedRows.filter((r) => {
            const ex = stored.get(r.achievement_id as string);
            if (!ex) return true;
            if (!ex.icon_url && r.icon_url) return true;
            return false;
          });
        }
        if (lockedToWrite.length > 0) {
          const lockedMeta = lockedToWrite.map(({ unlocked: _u, unlocked_at: _t, ...rest }: any) => rest);
          const err = await upsertChunked(
            db,
            'user_xbox_achievements',
            lockedMeta,
            'profile_id,xbox_title_id,achievement_id',
          );
          if (err) console.error(`[xbox/sync-achievements] locked upsert ${t.titleId}:`, JSON.stringify(err));
          else rowsSynced += lockedToWrite.length;
        }
      }

      lastProcessedId = t.titleId;
      titlesProcessed++;
    } catch (e) {
      if (isXboxAuthInvalid(e)) {
        return json({
          error: 'Your Xbox API key is no longer valid. Reconnect from Settings.',
          needsReconnect: true,
        }, 401);
      }
      console.error(`[xbox/sync-achievements] error processing ${t.titleId}:`, e);
      lastProcessedId = t.titleId;
      titlesProcessed++;
    }
  }

  if (schemaUpserts.length > 0) {
    const { error } = await (db as any)
      .from('xbox_title_schema')
      .upsert(schemaUpserts, { onConflict: 'xbox_title_id' });
    if (error) console.error('[xbox/sync-achievements] schema cache upsert:', JSON.stringify(error));
  }
  if (noStatsUpserts.length > 0) {
    const { error } = await (db as any)
      .from('xbox_title_schema')
      .upsert(noStatsUpserts, { onConflict: 'xbox_title_id' });
    if (error) console.error('[xbox/sync-achievements] no-stats cache upsert:', JSON.stringify(error));
  }

  const done = remaining.filter((t) => t.titleId > lastProcessedId).length === 0;
  const processedCount = titles.filter((t) => t.titleId <= lastProcessedId).length;

  const singleBatchTotalFailure =
    done && isFreshStart && candidates.length > 0 && rowsSynced === 0 && achievementNulls > 0;

  await (db as any)
    .from('profiles')
    .update(
      done
        ? (singleBatchTotalFailure
            ? { xbox_sync_cursor: null, xbox_sync_snapshot: null }
            : {
                xbox_achievements_synced_at: new Date().toISOString(),
                xbox_sync_cursor: null,
                xbox_sync_snapshot: null,
              })
        : { xbox_sync_cursor: { titleId: lastProcessedId } },
    )
    .eq('id', profile.id);

  return json({
    processed: processedCount,
    total,
    syncedThisCall: rowsSynced,
    hitAchievements: achievementHits,
    emptyResponses: achievementNulls,
    everSynced: !!lastSync,
    nextCursor: done ? null : lastProcessedId,
    done,
  });
};
