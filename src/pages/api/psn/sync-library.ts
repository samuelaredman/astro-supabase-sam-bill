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
} from "../../../utils/psn";
import { getServiceAuth } from "../../../utils/psnService";

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

// Platform priority when the same game exists on multiple PSN platforms. PS5
// entries win over PS4 win over PS3, matching what a returning player is
// probably still playing.
const PLATFORM_RANK: Record<string, number> = { PS5: 3, PS4: 2, PS3: 1 };

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

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('psn_account_id, psn_access_token, psn_refresh_token, psn_token_expires_at, psn_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.psn_account_id) {
    return json({ error: 'No PlayStation account connected.' }, 400);
  }

  // Two auth modes:
  //   - "user tokens" (NPSSO paste flow) — psn_refresh_token is present. We
  //     refresh the access token on demand and persist any rotation.
  //   - "service token" (username-only connect flow) — psn_refresh_token is
  //     NULL. We use the shared Chekpoint service token and only read PUBLIC
  //     data (no playtime, no private games). getServiceAuth handles its own
  //     refresh cycle against psn_service_auth.
  const useServiceAuth = !profileData.psn_refresh_token;

  // Same 1-minute cooldown as Steam import — protects against accidental
  // double-clicks that would burn Sony API rate limit for no benefit.
  if (profileData.psn_synced_at) {
    const secondsSince = (Date.now() - new Date(profileData.psn_synced_at).getTime()) / 1000;
    if (secondsSince < 60) {
      const wait = Math.ceil(60 - secondsSince);
      return json({ error: `Please wait ${wait}s before syncing again.` }, 429);
    }
  }

  let authPayload;
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

  // Full trophy-title list (games with at least one trophy earned) across all
  // platforms. This is our source of truth for the PSN "library".
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

  // Playtime is best-effort (PS4/PS5 only, ~50 recent titles). Sony only
  // returns playtime for the AUTHENTICATED account, so username-only users
  // (service auth) get an empty map here — no error, just no playtime data.
  // Failures under user auth are non-fatal — the library still syncs.
  const playtimeByLowerName = new Map<string, { minutes: number; lastPlayed: string | null }>();
  if (!useServiceAuth) {
    const recent = await fetchRecentPlayedGames(authPayload);
    for (const r of recent) {
      if (!r.name) continue;
      const key = r.name.toLowerCase().trim();
      // If the same game shows up twice (rare — PS4+PS5 remaster), keep the
      // entry with more minutes.
      const prev = playtimeByLowerName.get(key);
      if (!prev || r.playDurationMinutes > prev.minutes) {
        playtimeByLowerName.set(key, { minutes: r.playDurationMinutes, lastPlayed: r.lastPlayedDateTime });
      }
    }
  }

  // Collapse titles with the same name across platforms into a single entry.
  // Persona 5 Royal on PS4 and PS5 have distinct npCommunicationIds but the
  // same trophyTitleName — user_game_status is UNIQUE(profile_id, game_id) so
  // we can only store one PSN identifier per game. Prefer the newer platform
  // (PS5 > PS4 > PS3) and record its ID / progress.
  type CollapsedTitle = {
    name: string;
    npCommId: string;
    platform: 'PS3' | 'PS4' | 'PS5';
    earned: number;
    total: number;
    progress: number;
    lastUpdatedDateTime: string | null;
  };
  const bestByName = new Map<string, CollapsedTitle>();
  for (const t of titles) {
    const platform = primaryPsnPlatform(t.trophyTitlePlatform);
    if (!platform) continue; // Vita/PSP only — not surfaced in the UI
    const name = t.trophyTitleName?.trim();
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
      progress: t.progress ?? 0,
      lastUpdatedDateTime: t.lastUpdatedDateTime ?? null,
    };
    const prev = bestByName.get(key);
    if (!prev || PLATFORM_RANK[platform] > PLATFORM_RANK[prev.platform]) {
      bestByName.set(key, candidate);
    }
  }

  const collapsed = Array.from(bestByName.values());
  const psnTitles = collapsed.map((c) => c.name);

  // Match by title against games — parallel RPC batches, same shape as Steam
  // import. match_psn_games returns at most one row per input title.
  const matchBatches = await Promise.all(
    chunk(psnTitles, TITLE_CHUNK).map((titleBatch) =>
      (db as any).rpc('match_psn_games', { psn_titles: titleBatch }),
    ),
  );

  const matches: Array<{ id: string; title: string; psn_title: string }> = [];
  const seenGameIds = new Set<string>();
  for (const { data, error } of matchBatches) {
    if (error) {
      console.error('[psn/sync-library] match_psn_games error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (data ?? []) as Array<{ id: string; title: string; psn_title: string }>) {
      if (!seenGameIds.has(row.id)) {
        seenGameIds.add(row.id);
        matches.push(row);
      }
    }
  }

  if (matches.length === 0) {
    await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: titles.length, total: titles.length });
  }

  // Existing user_game_status rows for the matched games — don't clobber
  // manual statuses (playing/completed/dropped/etc.). We only insert new rows
  // with 'owned' status; existing rows just get PSN metadata refreshed.
  const matchedGameIds = matches.map((m) => m.id);
  const existingByGameId = new Map<string, string>();
  const existingChunks = await Promise.all(
    chunk(matchedGameIds, IN_CHUNK).map((ids) =>
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

  const collapsedByLowerName = new Map(collapsed.map((c) => [c.name.toLowerCase(), c]));

  const toInsert: any[] = [];
  const toUpdate: Array<{ game_id: string; row: Record<string, unknown> }> = [];

  for (const match of matches) {
    const psnEntry = collapsedByLowerName.get((match.psn_title ?? match.title).toLowerCase().trim());
    if (!psnEntry) continue;
    const playtime = playtimeByLowerName.get(psnEntry.name.toLowerCase()) ?? null;

    const row: Record<string, unknown> = {
      psn_np_communication_id: psnEntry.npCommId,
      psn_platform: psnEntry.platform,
      psn_trophies_earned: psnEntry.earned,
      psn_trophies_total: psnEntry.total,
      psn_progress: psnEntry.progress,
      psn_playtime_minutes: playtime?.minutes ?? null,
      psn_last_played_at: playtime?.lastPlayed ?? psnEntry.lastUpdatedDateTime ?? null,
    };

    if (!existingByGameId.has(match.id)) {
      toInsert.push({
        profile_id: profile.id,
        game_id: match.id,
        status: 'owned',
        is_owned: true,
        ...row,
      });
    } else {
      toUpdate.push({ game_id: match.id, row });
    }
  }

  for (const batch of chunk(toInsert, WRITE_CHUNK)) {
    const { error: insertError } = await (db as any).from('user_game_status').insert(batch);
    if (insertError) {
      console.error('[psn/sync-library] insert error:', JSON.stringify(insertError));
      return json({ error: 'Failed to save game statuses.' }, 500);
    }
  }

  // .update() is per-row here; the volume is bounded by matches count (usually
  // < 1000), and there's no bulk RPC yet. If this becomes a hot spot we can
  // add bulk_update_psn_progress like the Steam bulk-playtime RPC.
  for (const { game_id, row } of toUpdate) {
    const { error: updateError } = await (db as any)
      .from('user_game_status')
      .update(row)
      .eq('profile_id', profile.id)
      .eq('game_id', game_id);
    if (updateError) {
      console.error('[psn/sync-library] update error (non-fatal):', JSON.stringify(updateError));
    }
  }

  await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);

  return json({
    matched: toInsert.length,
    updated: toUpdate.length,
    unmatched: titles.length - matches.length,
    total: titles.length,
  });
};
