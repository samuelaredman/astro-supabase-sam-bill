import type { APIRoute } from "astro";
import { requireAuth, json, type SupabaseAdmin } from "../../../utils/api";
import {
  getFreshAuth,
  isPsnAuthExpired,
  fetchAllTitles,
  fetchRecentPlayedGames,
  primaryPsnPlatform,
  type PsnTokens,
  type TrophyTitle,
  type AuthorizationPayload,
} from "../../../utils/psn";
import { getServiceAuth } from "../../../utils/psnService";
import { igdbMultiQuery, escapeIgdbString } from "../../../utils/igdb";
import { importGameByIgdbId } from "../../../utils/games";

// Netlify's SSR function budget is 10s. Reserve ~3s for post-processing DB
// writes (user_game_status inserts, snapshot save). Each call drains as many
// unmatched titles as fit in the remaining IGDB+import budget; the client
// auto-continues via the returned cursor.
const TIME_BUDGET_MS = 7000;

// IGDB rate-limits at 4 req/s regardless of sub-query count. Batch 10 titles
// per multiquery call to minimize HTTP overhead and stay well under the limit
// even with a couple of serial multiquery calls per invocation.
const MULTIQUERY_BATCH = 10;

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

// Fresh-start cooldown (same as before — protects against double-clicks). A
// cursor-continuation call skips this since it's part of an already-running
// sync, not a fresh request.
const COOLDOWN_SECONDS = 60;

// Snapshot lifetime — reuse the pre-filtered work queue across cursor
// continuations of one sync run. 24h is comfortable for a human-paced sync
// loop; anything older triggers a fresh rebuild from fetchAllTitles.
const SNAPSHOT_TTL_MS = 24 * 3600 * 1000;

// Platform priority when the same game exists on multiple PSN platforms. PS5
// entries win over PS4 win over PS3, matching what a returning player is
// probably still playing.
const PLATFORM_RANK: Record<string, number> = { PS5: 3, PS4: 2, PS3: 1 };

// PSN platform → IGDB platform id. Narrowing by platform resolves most of the
// title-collision cases the old matcher got wrong: 2017 SW Battlefront II is
// PS4-only (IGDB id 48), 2005 original is PS2-only; Ratchet & Clank (2016)
// is PS4-only, prior entries are PS3/PS2. PS3 = IGDB 9, PS4 = 48, PS5 = 167.
const IGDB_PLATFORM_BY_PSN: Record<'PS3' | 'PS4' | 'PS5', number> = {
  PS3: 9,
  PS4: 48,
  PS5: 167,
};

type UnmatchedEntry = {
  npCommId: string;
  platform: 'PS3' | 'PS4' | 'PS5';
  name: string;                 // trimmed, "Trophies" suffix already stripped
  lastUpdatedDateTime: string | null;
  earned: number;
  total: number;
  hasPlatinum: boolean;
  progress: number;
};

type Snapshot = {
  started_at: string;
  // Unmatched work queue, sorted by npCommId so a string cursor is monotonic.
  unmatched: UnmatchedEntry[];
  // Lowercase-name → { minutes, lastPlayed }. Needed when writing
  // user_game_status rows for titles newly matched in a continuation call —
  // we can't re-call fetchRecentPlayedGames each cursor tick.
  playtime: Record<string, { minutes: number; lastPlayed: string | null }>;
  // Counts for the progress UI. total_titles is the full PSN library size
  // (matched + unmatched); initial_matched is what the first call resolved
  // via the DB fast-path.
  total_titles: number;
  initial_matched: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function persistTokens(db: SupabaseAdmin, profileId: string, tokens: PsnTokens): Promise<void> {
  await (db as any).from('profiles').update({
    psn_access_token: tokens.access_token,
    psn_refresh_token: tokens.refresh_token,
    psn_token_expires_at: tokens.expires_at,
  }).eq('id', profileId);
}

// Collapse PSN titles by display name, picking the newest-platform edition
// when the same game ships on PS4+PS5. Same shape as the pre-cursor version.
function collapseTitles(titles: TrophyTitle[]): UnmatchedEntry[] {
  const bestByName = new Map<string, UnmatchedEntry>();
  for (const t of titles) {
    const platform = primaryPsnPlatform(t.trophyTitlePlatform);
    if (!platform) continue;
    const name = t.trophyTitleName?.trim().replace(/\s+Trophies$/i, '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const total =
      (t.definedTrophies?.bronze ?? 0) +
      (t.definedTrophies?.silver ?? 0) +
      (t.definedTrophies?.gold ?? 0) +
      (t.definedTrophies?.platinum ?? 0);
    const earned =
      (t.earnedTrophies?.bronze ?? 0) +
      (t.earnedTrophies?.silver ?? 0) +
      (t.earnedTrophies?.gold ?? 0) +
      (t.earnedTrophies?.platinum ?? 0);
    const candidate: UnmatchedEntry = {
      npCommId: t.npCommunicationId,
      platform,
      name,
      earned,
      total,
      hasPlatinum: (t.earnedTrophies?.platinum ?? 0) > 0,
      progress: t.progress ?? 0,
      lastUpdatedDateTime: t.lastUpdatedDateTime ?? null,
    };
    const prev = bestByName.get(key);
    if (!prev || PLATFORM_RANK[platform] > PLATFORM_RANK[prev.platform]) {
      bestByName.set(key, candidate);
    }
  }
  return Array.from(bestByName.values());
}

// Picks one IGDB game from the search result, matching the same disambiguation
// rule the single-title path used before multiquery: most-recent release
// ≤ user's lastUpdatedDateTime, with game_type=0 (main_game) as a tiebreaker.
// Returns the IGDB id, or null if 0 hits / every hit lacks a release date.
function pickIgdbId(hits: any[]): number | null {
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const withDate = hits.filter((h) => Number.isFinite(h?.first_release_date));
  if (withDate.length === 0) return null;
  withDate.sort((a, b) => {
    const d = (b.first_release_date ?? 0) - (a.first_release_date ?? 0);
    if (d !== 0) return d;
    const aMain = a.game_type === 0 ? 0 : 1;
    const bMain = b.game_type === 0 ? 0 : 1;
    return aMain - bMain;
  });
  const pick = withDate[0];
  const id = Number(pick?.id);
  return Number.isFinite(id) ? id : null;
}

// Build the apicalypse body for one IGDB sub-query.
function buildIgdbSubquery(entry: UnmatchedEntry): string {
  const platformId = IGDB_PLATFORM_BY_PSN[entry.platform];
  const searchName = entry.name
    .replace(/[™®©]/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const lastUpdatedUnix = entry.lastUpdatedDateTime
    ? Math.floor(new Date(entry.lastUpdatedDateTime).getTime() / 1000)
    : null;
  const dateClause = Number.isFinite(lastUpdatedUnix as number)
    ? ` & first_release_date <= ${lastUpdatedUnix}`
    : '';
  return `
    search "${escapeIgdbString(searchName)}";
    fields id, name, platforms.id, game_type, first_release_date;
    where platforms = (${platformId}) & game_type = (0,2,4,8,9,10)${dateClause};
    limit 5;
  `;
}

type ResolvedMatch = { entry: UnmatchedEntry; gameId: string };

// Fetch user_game_status rows keyed by canonical for the given canonical ids,
// returning the set of ids where a row already exists. Used to decide
// insert-with-status='owned' vs update-metadata-only.
async function loadExistingStatusGameIds(
  db: any,
  profileId: string,
  canonicalIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const chunks = await Promise.all(
    chunk(canonicalIds, IN_CHUNK).map((ids) =>
      db
        .from('user_game_status')
        .select('game_id')
        .eq('profile_id', profileId)
        .in('game_id', ids),
    ),
  );
  for (const { data } of chunks) {
    for (const r of (data ?? [])) out.add(r.game_id);
  }
  return out;
}

// Writes user_game_status rows for the given matches. Mirrors the pre-cursor
// "resolve matched games to canonical, pick best edition per canonical, insert
// new / update existing" logic — just factored out so it can run on every
// cursor-continuation batch rather than only at the end.
async function writeMatchesToLibrary(
  db: any,
  profileId: string,
  matches: ResolvedMatch[],
  playtimeByLowerName: Map<string, { minutes: number; lastPlayed: string | null }>,
): Promise<{ inserted: number; updated: number }> {
  if (matches.length === 0) return { inserted: 0, updated: 0 };

  const matchedGameIds = matches.map((m) => m.gameId);
  const canonicalOf = new Map<string, string>();
  const canonChunks = await Promise.all(
    chunk(matchedGameIds, IN_CHUNK).map((ids) =>
      db.from('games').select('id, canonical_game_id').in('id', ids),
    ),
  );
  for (const { data: rows } of canonChunks) {
    for (const r of ((rows ?? []) as any[])) {
      canonicalOf.set(r.id, r.canonical_game_id ?? r.id);
    }
  }

  type AggRow = {
    row: Record<string, unknown>;
    _lastPlayedTs: number;
    _bestProgress: number;
  };
  const perCanonical = new Map<string, AggRow>();
  for (const { entry, gameId } of matches) {
    const canonicalId = canonicalOf.get(gameId) ?? gameId;
    const playtime = playtimeByLowerName.get(entry.name.toLowerCase()) ?? null;
    const lastPlayedAt = playtime?.lastPlayed ?? entry.lastUpdatedDateTime ?? null;
    const row: Record<string, unknown> = {
      psn_np_communication_id: entry.npCommId,
      psn_platform: entry.platform,
      psn_trophies_earned: entry.earned,
      psn_trophies_total: entry.total,
      psn_platinum_earned: entry.hasPlatinum,
      psn_progress: entry.progress,
      psn_playtime_minutes: playtime?.minutes ?? null,
      psn_last_played_at: lastPlayedAt,
      psn_display_game_id: gameId,
    };
    const lastPlayedTs = lastPlayedAt ? Date.parse(lastPlayedAt) : 0;
    const existing = perCanonical.get(canonicalId);
    const beats =
      !existing ||
      lastPlayedTs > existing._lastPlayedTs ||
      (lastPlayedTs === existing._lastPlayedTs && entry.progress > existing._bestProgress);
    if (beats) {
      perCanonical.set(canonicalId, { row, _lastPlayedTs: lastPlayedTs, _bestProgress: entry.progress });
    }
  }

  const canonicalIds = [...perCanonical.keys()];
  const existingIds = await loadExistingStatusGameIds(db, profileId, canonicalIds);

  const toInsert: any[] = [];
  const toUpdate: Array<{ game_id: string; row: Record<string, unknown> }> = [];
  for (const [canonicalId, agg] of perCanonical) {
    if (!existingIds.has(canonicalId)) {
      toInsert.push({ profile_id: profileId, game_id: canonicalId, status: 'owned', is_owned: true, ...agg.row });
    } else {
      toUpdate.push({ game_id: canonicalId, row: agg.row });
    }
  }

  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    const { error } = await db.from('user_game_status').insert(batch);
    if (error) {
      console.error('[psn/sync-library] insert error:', JSON.stringify(error));
      throw new Error('Failed to save game statuses.');
    }
  }

  for (const { game_id, row } of toUpdate) {
    const { error } = await db
      .from('user_game_status')
      .update(row)
      .eq('profile_id', profileId)
      .eq('game_id', game_id);
    if (error) {
      console.error('[psn/sync-library] update error (non-fatal):', JSON.stringify(error));
    }
  }

  return { inserted: toInsert.length, updated: toUpdate.length };
}

export const POST: APIRoute = async (context) => {
  const startedAt = Date.now();

  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => ({} as any));
  // Cursor is "truthy string" OR empty string on continuation. Previously we
  // treated the empty string as "no cursor" via a string.length > 0 check,
  // which caused a stall on the first call for large libraries: when the
  // snapshot build consumed the full time budget and no IGDB entries were
  // processed, we returned nextCursor='' legitimately, but the next call
  // read it as falsy → fresh start → rebuilt the snapshot from scratch and
  // looped. Distinguishing "no cursor key" vs "empty-string cursor" fixes
  // this.
  const bodyHasCursor = typeof body.cursor === 'string';
  const force = body.force === true;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select(
      'psn_account_id, psn_access_token, psn_refresh_token, psn_token_expires_at, ' +
      'psn_synced_at, psn_library_sync_snapshot, psn_library_sync_cursor',
    )
    .eq('id', profile.id)
    .single();

  if (!profileData?.psn_account_id) {
    return json({ error: 'No PlayStation account connected.' }, 400);
  }

  // See sync-trophies.ts for the two-auth-mode explainer: service auth for
  // username-only users (public data only), user tokens for NPSSO users.
  const useServiceAuth = !profileData.psn_refresh_token;

  // Snapshot presence is the authoritative signal for "we're mid-sync",
  // NOT cursor presence. An empty-string cursor paired with a fresh
  // snapshot is a valid "snapshot built, haven't processed any IGDB yet"
  // state.
  const existingSnapshot = profileData.psn_library_sync_snapshot as Snapshot | null;
  const snapshotFresh =
    !!existingSnapshot?.started_at &&
    Date.now() - new Date(existingSnapshot.started_at).getTime() < SNAPSHOT_TTL_MS;
  const hasValidSnapshot = snapshotFresh && Array.isArray(existingSnapshot?.unmatched);

  // Resolve the cursor envelope: explicit body cursor wins, otherwise fall
  // back to whatever the last call persisted on the profile.
  const persistedCursor = (profileData.psn_library_sync_cursor as any)?.npCommId;
  const cursor: string | null = bodyHasCursor
    ? (body.cursor as string)
    : typeof persistedCursor === 'string'
      ? persistedCursor
      : null;

  // A "fresh start" needs us to walk PSN titles and rebuild — only the case
  // when we don't have a usable snapshot. Everything else, whether the
  // client is passing a cursor or not, is a continuation of an existing
  // sync run.
  const canReuseSnapshot = hasValidSnapshot && !force;
  const isFreshStart = !canReuseSnapshot;

  // Debounce fresh starts only. Cursor continuations skip the cooldown — they
  // are part of an already-in-flight sync, not a new user action.
  if (profileData.psn_synced_at && isFreshStart && !force) {
    const secondsSince = (Date.now() - new Date(profileData.psn_synced_at).getTime()) / 1000;
    if (secondsSince < COOLDOWN_SECONDS) {
      const wait = Math.ceil(COOLDOWN_SECONDS - secondsSince);
      return json({ error: `Please wait ${wait}s before syncing again.` }, 429);
    }
  }

  let authPayload: AuthorizationPayload;
  if (useServiceAuth) {
    try {
      authPayload = await getServiceAuth();
    } catch (e) {
      console.error('[psn/sync-library] service auth unavailable:', e);
      return json({ error: 'PlayStation sync is temporarily unavailable. Try again in a minute.' }, 502);
    }
  } else {
    try {
      const fresh = await getFreshAuth({
        access_token: profileData.psn_access_token,
        refresh_token: profileData.psn_refresh_token,
        expires_at: profileData.psn_token_expires_at,
      });
      authPayload = fresh.auth;
      if (fresh.refreshed) await persistTokens(db, profile.id, fresh.tokens);
    } catch (e) {
      if (isPsnAuthExpired(e)) {
        return json({
          error: 'Your PlayStation connection expired. Reconnect by pasting a fresh NPSSO token.',
          needsReconnect: true,
        }, 401);
      }
      console.error('[psn/sync-library] token refresh error:', e);
      return json({ error: 'PlayStation is temporarily unavailable. Try again in a minute.' }, 502);
    }
  }

  // ─────────────────────────── snapshot build or reuse ────────────────────────
  //
  // canReuseSnapshot (computed above) → load the existing snapshot and keep
  // going. Otherwise walk PSN, DB-match, write matched rows to
  // user_game_status, snapshot the unmatched queue.

  let snapshot: Snapshot;
  let initialMatchedThisCall = 0;
  let initialUpdatedThisCall = 0;

  if (canReuseSnapshot) {
    snapshot = existingSnapshot!;
  } else {
    // Fresh walk.
    let titles: TrophyTitle[];
    try {
      titles = await fetchAllTitles(authPayload, profileData.psn_account_id);
    } catch (e) {
      if (isPsnAuthExpired(e)) {
        return json({
          error: 'Your PlayStation connection expired. Reconnect by pasting a fresh NPSSO token.',
          needsReconnect: true,
        }, 401);
      }
      console.error('[psn/sync-library] getUserTitles error:', e);
      return json({ error: 'PlayStation is temporarily unavailable. Try again in a minute.' }, 502);
    }

    const collapsed = collapseTitles(titles);

    // Playtime — PS4/PS5 recent-played list. Only populated for user-token
    // auth (service token can't see playtime). Non-fatal on failure.
    const playtimeByLowerName = new Map<string, { minutes: number; lastPlayed: string | null }>();
    if (!useServiceAuth) {
      try {
        const recent = await fetchRecentPlayedGames(authPayload);
        for (const r of recent) {
          if (!r.name) continue;
          const key = r.name.toLowerCase().trim();
          const prev = playtimeByLowerName.get(key);
          if (!prev || r.playDurationMinutes > prev.minutes) {
            playtimeByLowerName.set(key, { minutes: r.playDurationMinutes, lastPlayed: r.lastPlayedDateTime });
          }
        }
      } catch (e) {
        console.error('[psn/sync-library] fetchRecentPlayedGames (non-fatal):', e);
      }
    }

    // DB fast-path match — anything already seeded on games.psn_np_communication_id.
    const matchBatches = await Promise.all(
      chunk(collapsed, TITLE_CHUNK).map((entries) =>
        (db as any).rpc('match_psn_games', {
          psn_np_comm_ids: entries.map((e) => e.npCommId),
        }),
      ),
    );
    type MatchRow = { id: string; psn_np_communication_id: string };
    const dbMatches: MatchRow[] = [];
    const seenGameIds = new Set<string>();
    for (const { data, error } of matchBatches) {
      if (error) {
        console.error('[psn/sync-library] match_psn_games error:', JSON.stringify(error));
        return json({ error: 'Failed to match games.' }, 500);
      }
      for (const row of (data ?? []) as MatchRow[]) {
        if (seenGameIds.has(row.id)) continue;
        seenGameIds.add(row.id);
        dbMatches.push(row);
      }
    }

    // Write the DB-matched games to the library immediately so the user sees
    // their library populate on the very first call, while the IGDB pass
    // churns in the background across subsequent cursor calls.
    const collapsedByNpCommId = new Map(collapsed.map((c) => [c.npCommId, c]));
    const initialResolved: ResolvedMatch[] = [];
    for (const m of dbMatches) {
      const entry = collapsedByNpCommId.get(m.psn_np_communication_id);
      if (entry) initialResolved.push({ entry, gameId: m.id });
    }
    try {
      const { inserted, updated } = await writeMatchesToLibrary(
        db,
        profile.id,
        initialResolved,
        playtimeByLowerName,
      );
      initialMatchedThisCall = inserted;
      initialUpdatedThisCall = updated;
    } catch (e: any) {
      return json({ error: e?.message || 'Failed to save game statuses.' }, 500);
    }

    // Build the unmatched snapshot, sorted by npCommId for stable cursoring.
    const matchedIds = new Set(dbMatches.map((m) => m.psn_np_communication_id));
    const unmatched = collapsed
      .filter((c) => !matchedIds.has(c.npCommId))
      .sort((a, b) => a.npCommId.localeCompare(b.npCommId));

    const playtimeObject: Record<string, { minutes: number; lastPlayed: string | null }> = {};
    for (const [k, v] of playtimeByLowerName) playtimeObject[k] = v;

    snapshot = {
      started_at: new Date().toISOString(),
      unmatched,
      playtime: playtimeObject,
      total_titles: collapsed.length,
      initial_matched: initialResolved.length,
    };

    await (db as any)
      .from('profiles')
      .update({ psn_library_sync_snapshot: snapshot })
      .eq('id', profile.id);
  }

  // ─────────────────────────── IGDB batch pass ────────────────────────────────

  const remainingUnmatched = cursor
    ? snapshot.unmatched.filter((u) => u.npCommId > cursor)
    : snapshot.unmatched;

  // Rebuild the playtime map from the snapshot so writeMatchesToLibrary can
  // apply playtime to newly-matched games in continuation calls.
  const playtimeByLowerName = new Map<string, { minutes: number; lastPlayed: string | null }>();
  for (const [k, v] of Object.entries(snapshot.playtime ?? {})) {
    playtimeByLowerName.set(k, v);
  }

  let batchMatched = 0;
  let batchUpdated = 0;
  let batchUnmatched = 0;
  let lastProcessedId = cursor ?? '';
  let processedThisCall = 0;

  if (remainingUnmatched.length > 0) {
    // Multiquery batches of 10 — IGDB rate-limits at 4 req/s and each
    // multiquery counts as one request regardless of sub-query count, so 10
    // titles per HTTP is the sweet spot between rate-limit efficiency and
    // import latency per batch.
    outer: for (const batch of chunk(remainingUnmatched, MULTIQUERY_BATCH)) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const subs = batch.map((entry, i) => ({
        name: `q${i}`,
        body: buildIgdbSubquery(entry),
      }));

      let results: Map<string, any[]> | null = null;
      try {
        results = await igdbMultiQuery('games', subs);
      } catch (e) {
        console.error('[psn/sync-library] multiquery error:', e);
      }

      const batchResolved: ResolvedMatch[] = [];
      for (let i = 0; i < batch.length; i++) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          // Partial batch — stop here but keep already-imported entries so
          // the cursor advances to the last one we fully processed.
          break outer;
        }
        const entry = batch[i];
        const hits = results?.get(`q${i}`) ?? null;
        const igdbId = hits ? pickIgdbId(hits) : null;
        if (!igdbId) {
          batchUnmatched++;
          lastProcessedId = entry.npCommId;
          processedThisCall++;
          continue;
        }
        try {
          const result = await importGameByIgdbId(db, igdbId);
          if (!result.ok) {
            console.error('[psn/sync-library] auto-import failed:', entry.name, result.error);
            batchUnmatched++;
            lastProcessedId = entry.npCommId;
            processedThisCall++;
            continue;
          }
          // Seed the npCommId mapping on games — the entire fleet benefits
          // next time anyone's library contains this title. The `is null`
          // guard + unique index on games.psn_np_communication_id prevents
          // clobbering concurrent writes.
          const { error: mapErr } = await (db as any)
            .from('games')
            .update({ psn_np_communication_id: entry.npCommId })
            .eq('id', result.game.id)
            .is('psn_np_communication_id', null);
          if (mapErr) {
            console.error('[psn/sync-library] mapping write (non-fatal):', JSON.stringify(mapErr));
          }
          batchResolved.push({ entry, gameId: result.game.id });
        } catch (e) {
          console.error('[psn/sync-library] import error for', entry.name, e);
          batchUnmatched++;
        }
        lastProcessedId = entry.npCommId;
        processedThisCall++;
      }

      if (batchResolved.length > 0) {
        try {
          const { inserted, updated } = await writeMatchesToLibrary(
            db,
            profile.id,
            batchResolved,
            playtimeByLowerName,
          );
          batchMatched += inserted;
          batchUpdated += updated;
        } catch (e: any) {
          console.error('[psn/sync-library] library write error:', e);
          // Budget exhausted via a failed write — bail; cursor isn't
          // advanced past these entries so the next call retries them.
          break;
        }
      }
    }
  }

  const done = snapshot.unmatched.filter((u) => u.npCommId > lastProcessedId).length === 0;
  const processedTotal = snapshot.unmatched.filter((u) => u.npCommId <= lastProcessedId).length;

  if (done) {
    await (db as any)
      .from('profiles')
      .update({
        psn_synced_at: new Date().toISOString(),
        psn_library_sync_cursor: null,
        psn_library_sync_snapshot: null,
      })
      .eq('id', profile.id);
  } else {
    await (db as any)
      .from('profiles')
      .update({ psn_library_sync_cursor: { npCommId: lastProcessedId } })
      .eq('id', profile.id);
  }

  // Flatten the response: client runs one accumulator across cursor-continuation
  // calls. matched/updated here are per-call deltas. total_unmatched_remaining
  // powers a determinate progress bar.
  return json({
    matched: initialMatchedThisCall + batchMatched,
    updated: initialUpdatedThisCall + batchUpdated,
    unmatched_this_batch: batchUnmatched,
    processed_this_call: processedThisCall,
    unmatched_total: snapshot.unmatched.length,
    unmatched_processed: processedTotal,
    total: snapshot.total_titles,
    initial_matched: snapshot.initial_matched,
    done,
    nextCursor: done ? null : lastProcessedId,
  });
};
