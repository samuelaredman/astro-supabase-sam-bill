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
import { igdbFetch, escapeIgdbString } from "../../../utils/igdb";
import { importGameByIgdbId } from "../../../utils/games";

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

// IGDB fallback cap. match_psn_games resolves the vast majority of titles
// against the local games table — IGDB is only needed for truly-new titles.
// 20 fits comfortably in the time budget now that the bulk-update RPCs
// (migration 20261127000002) collapsed the write-stage round trips.
// Stragglers past the cap log to psn_unmatched_titles and get picked up by
// future users' syncs via the fleet-seeding side effect.
const IGDB_FALLBACK_CAP = 20;

// Platform priority when the same game ships on multiple PSN platforms. PS5
// wins over PS4 wins over PS3, matching what a returning player probably
// still has installed.
const PLATFORM_RANK: Record<string, number> = { PS5: 3, PS4: 2, PS3: 1 };

// PSN platform → IGDB platform id. Used both for the DB match_psn_games RPC
// (which joins platforms by igdb_id) and for the IGDB fallback search.
const IGDB_PLATFORM_BY_PSN: Record<'PS3' | 'PS4' | 'PS5', number> = {
  PS3: 9,
  PS4: 48,
  PS5: 167,
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

// Picks one IGDB game from a search result, matching the same disambiguation
// rule the DB title-match uses: most recent release ≤ user's trophy-earn
// date, with game_type=0 (main_game) as a tiebreaker. Returns null for 0
// hits or every hit missing first_release_date.
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

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  // Continuation calls (client auto-looping to drain the IGDB fallback
  // across multiple requests) skip the cooldown — they're part of the
  // same user-initiated sync, not a new action to debounce.
  const body = await context.request.json().catch(() => ({} as any));
  const isContinuation = body.continuation === true;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('psn_account_id, psn_access_token, psn_refresh_token, psn_token_expires_at, psn_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.psn_account_id) {
    return json({ error: 'No PlayStation account connected.' }, 400);
  }

  // Two auth modes: service token (username-only connect, public data only)
  // vs user tokens (NPSSO paste, playtime + private profiles). See
  // sync-trophies.ts for the full explainer.
  const useServiceAuth = !profileData.psn_refresh_token;

  // 60s cooldown against accidental double-clicks. Skipped on continuation
  // calls from the client auto-loop.
  if (profileData.psn_synced_at && !isContinuation) {
    const secondsSince = (Date.now() - new Date(profileData.psn_synced_at).getTime()) / 1000;
    if (secondsSince < 60) {
      const wait = Math.ceil(60 - secondsSince);
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

  // Full trophy-title list — Sony's source of truth for "games this user has
  // interacted with on PSN."
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

  if (titles.length === 0) {
    await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: 0, total: 0 });
  }

  // Playtime is user-auth only (PS4/PS5 recent-played list). Non-fatal on failure.
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

  // Collapse titles with the same display name across platforms into a
  // single entry — Persona 5 Royal on PS4 and PS5 have different npCommIds
  // but user_game_status is UNIQUE(profile_id, game_id). Prefer the newer
  // platform (PS5 > PS4 > PS3) and record its npCommId / progress.
  type CollapsedTitle = {
    name: string;
    npCommId: string;
    platform: 'PS3' | 'PS4' | 'PS5';
    earned: number;
    total: number;
    hasPlatinum: boolean;
    progress: number;
    lastUpdatedDateTime: string | null;
  };
  const bestByName = new Map<string, CollapsedTitle>();
  for (const t of titles) {
    const platform = primaryPsnPlatform(t.trophyTitlePlatform);
    if (!platform) continue;
    // Strip the " Trophies" suffix PSN appends to some trophy set names.
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
    const candidate: CollapsedTitle = {
      name,
      npCommId: t.npCommunicationId,
      platform,
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

  const collapsed = Array.from(bestByName.values());

  // ────────── DB match: ID + title+platform+date in a single RPC ──────────
  //
  // Batched into parallel arrays and sent to match_psn_games (migration
  // 20261127000001). The RPC returns input_index + game_id + matched_by so
  // we can zip back and backfill psn_np_communication_id on title-matched
  // rows — the next user with the same title hits the ID fast-path.

  // matched_by: 'id' | 'title_date' (new) | 'title_platform_date' (legacy
  // signature, pre-migration 20261127000003). The specific value only
  // matters for deciding whether to backfill psn_np_communication_id —
  // anything other than 'id' means we resolved via title fallback and
  // should seed the mapping so next user hits the ID fast path.
  type MatchRow = { input_index: number; game_id: string; matched_by: string };
  const matchBatches: MatchRow[][] = [];
  const titleChunks = chunk(collapsed, TITLE_CHUNK);
  let baseIndex = 0;
  for (const entries of titleChunks) {
    const { data, error } = await (db as any).rpc('match_psn_games', {
      psn_titles: entries.map((e) => e.name),
      psn_platform_igdb_ids: entries.map((e) => IGDB_PLATFORM_BY_PSN[e.platform]),
      psn_np_comm_ids: entries.map((e) => e.npCommId),
      psn_last_updated: entries.map((e) => e.lastUpdatedDateTime),
    });
    if (error) {
      console.error('[psn/sync-library] match_psn_games error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    // Shift input_index by the chunk's offset so the global index points
    // back into `collapsed`.
    for (const row of (data ?? []) as MatchRow[]) {
      matchBatches.push([{ ...row, input_index: row.input_index + baseIndex }]);
    }
    baseIndex += entries.length;
  }

  // Deduplicate by game_id — the RPC can map two inputs to the same game
  // (e.g., different npCommIds for the same release across platforms). First
  // write wins.
  const resolved: Array<{ entry: CollapsedTitle; gameId: string; backfillMapping: boolean }> = [];
  const seenGameIds = new Set<string>();
  for (const batch of matchBatches) {
    for (const row of batch) {
      if (seenGameIds.has(row.game_id)) continue;
      seenGameIds.add(row.game_id);
      const entry = collapsed[row.input_index];
      if (!entry) continue;
      resolved.push({
        entry,
        gameId: row.game_id,
        // Title-matched rows need the mapping written so future ID matches hit.
        backfillMapping: row.matched_by !== 'id',
      });
    }
  }

  // ────────── IGDB fallback for the thin tail ──────────
  //
  // Anything the DB RPC didn't match needs an IGDB auto-import. Capped so
  // the whole sync fits in Netlify's 10s budget. Any overflow (or 0-hit /
  // ambiguous results) is logged to psn_unmatched_titles for admin review
  // and picked up by the fleet seeding on the next user's sync.

  const matchedIndexes = new Set<number>();
  for (const batch of matchBatches) {
    for (const row of batch) matchedIndexes.add(row.input_index);
  }
  const unmatchedCollapsed = collapsed.filter((_, i) => !matchedIndexes.has(i));

  const toLog: CollapsedTitle[] = [...unmatchedCollapsed.slice(IGDB_FALLBACK_CAP)];
  const igdbCandidates = unmatchedCollapsed.slice(0, IGDB_FALLBACK_CAP);

  for (const entry of igdbCandidates) {
    try {
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
      const rows = await igdbFetch(
        'games',
        `
          search "${escapeIgdbString(searchName)}";
          fields id, name, platforms.id, game_type, first_release_date;
          where platforms = (${platformId}) & game_type = (0,2,4,8,9,10)${dateClause};
          limit 5;
        `,
      );
      const hits = Array.isArray(rows) ? rows : [];
      const igdbId = pickIgdbId(hits);
      if (!igdbId) {
        toLog.push(entry);
        continue;
      }
      const result = await importGameByIgdbId(db, igdbId);
      if (!result.ok) {
        console.error('[psn/sync-library] auto-import failed:', entry.name, result.error);
        toLog.push(entry);
        continue;
      }
      if (seenGameIds.has(result.game.id)) continue;
      seenGameIds.add(result.game.id);
      resolved.push({ entry, gameId: result.game.id, backfillMapping: true });
    } catch (e) {
      console.error('[psn/sync-library] IGDB fallback error for', entry.name, e);
      toLog.push(entry);
    }
  }

  // Log the stragglers for admin review. Fire-and-forget.
  if (toLog.length > 0) {
    (db as any).rpc('log_unmatched_psn_titles', {
      np_comm_ids: toLog.map((e) => e.npCommId),
      titles: toLog.map((e) => e.name),
      platforms: toLog.map((e) => e.platform),
    }).then(({ error }: any) => {
      if (error) {
        console.error('[psn/sync-library] log_unmatched_psn_titles (non-fatal):', JSON.stringify(error));
      }
    });
  }

  // ────────── Backfill mappings on title/IGDB-matched games ──────────
  //
  // Writing games.psn_np_communication_id for each newly-resolved mapping
  // means the next user with the same title hits the ID fast-path — this
  // is the per-fleet seeding mechanism that makes the sync faster the more
  // people use it. One bulk RPC instead of per-row UPDATEs (which blew
  // Netlify's 10s budget at ~3,000 title matches). The RPC's guard keeps
  // it safe against concurrent backfills from other users.
  const backfills = resolved.filter((r) => r.backfillMapping);
  if (backfills.length > 0) {
    const payload = backfills.map((b) => ({ game_id: b.gameId, np_comm_id: b.entry.npCommId }));
    const { error } = await (db as any).rpc('bulk_set_games_psn_mapping', { p_updates: payload });
    if (error) {
      console.error('[psn/sync-library] bulk_set_games_psn_mapping (non-fatal):', JSON.stringify(error));
    }
  }

  if (resolved.length === 0) {
    await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: titles.length, total: titles.length });
  }

  // ────────── Resolve canonical + write user_game_status ──────────
  //
  // Ownership belongs on the canonical game, not the collapsed edition. If
  // the user owns multiple editions that fold into the same canonical, keep
  // the most-recently-played edition's PSN metadata.

  const matchedGameIds = resolved.map((r) => r.gameId);
  const canonicalOf = new Map<string, string>();
  const canonChunks = await Promise.all(
    chunk(matchedGameIds, IN_CHUNK).map((ids) =>
      (db as any).from('games').select('id, canonical_game_id').in('id', ids),
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
  for (const { entry, gameId } of resolved) {
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

  // Existing user_game_status rows keyed by canonical — don't clobber manual
  // statuses (playing/completed/dropped/etc.). Only new rows get status='owned';
  // existing rows just get PSN metadata refreshed.
  const canonicalIds = [...perCanonical.keys()];
  const existingByGameId = new Map<string, string>();
  const existingChunks = await Promise.all(
    chunk(canonicalIds, IN_CHUNK).map((ids) =>
      (db as any)
        .from('user_game_status')
        .select('game_id, status')
        .eq('profile_id', profile.id)
        .in('game_id', ids),
    ),
  );
  for (const { data: rows } of existingChunks) {
    for (const r of (rows ?? [])) existingByGameId.set(r.game_id, r.status);
  }

  const toInsert: any[] = [];
  const toUpdate: Array<{ game_id: string; row: Record<string, unknown> }> = [];

  for (const [canonicalId, agg] of perCanonical) {
    if (!existingByGameId.has(canonicalId)) {
      toInsert.push({
        profile_id: profile.id,
        game_id: canonicalId,
        status: 'owned',
        is_owned: true,
        ...agg.row,
      });
    } else {
      toUpdate.push({ game_id: canonicalId, row: agg.row });
    }
  }

  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    const { error } = await (db as any).from('user_game_status').insert(batch);
    if (error) {
      console.error('[psn/sync-library] insert error:', JSON.stringify(error));
      return json({ error: 'Failed to save game statuses.' }, 500);
    }
  }

  // Bulk-update existing rows via the RPC (migration 20261127000002). One
  // SQL statement per batch instead of one round-trip per row — the per-row
  // loop was the dominant time cost for large libraries and the reason big
  // syncs were timing out at Netlify's 10s budget.
  for (const batch of chunk(toUpdate, WRITE_CHUNK)) {
    const payload = batch.map(({ game_id, row }) => ({ game_id, ...row }));
    const { error } = await (db as any).rpc('bulk_update_psn_library', {
      p_profile_id: profile.id,
      p_updates: payload,
    });
    if (error) {
      console.error('[psn/sync-library] bulk_update_psn_library (non-fatal):', JSON.stringify(error));
    }
  }

  await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);

  return json({
    matched: toInsert.length,
    updated: toUpdate.length,
    unmatched: titles.length - resolved.length,
    total: titles.length,
  });
};
