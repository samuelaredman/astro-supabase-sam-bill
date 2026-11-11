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
import { igdbFetch, escapeIgdbString } from "../../../utils/igdb";
import { importGameByIgdbId } from "../../../utils/games";

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

// IGDB auto-import budget for the unmatched pass. Each IGDB search + import
// takes ~300-600ms; cap per-sync work so we stay well under Netlify's 10s
// total budget. Anything past the cap is logged for admin review (or picked
// up on the user's next sync, since the cooldown is only 60s).
const IGDB_AUTO_IMPORT_CAP = 10;

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
    hasPlatinum: boolean;
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
      // Sony awards a platinum once every non-DLC trophy is earned, so this is
      // the reliable base-game-100% signal — stored so the library badge works
      // without a separate psn/sync-trophies pass.
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

  // Match against games using npCommunicationId first, title as fallback. The
  // RPC returns `matched_by: 'id' | 'title'` so we can backfill the mapping
  // onto title-matched games — the next sync (any user) hits the ID path.
  // Historical context: pure title matching dropped Apex Legends, EA SPORTS
  // College Football 25/26, STAR WARS Battlefront II, Ratchet & Clank (2016)
  // off real users' libraries because PSN display names rarely match IGDB
  // titles exactly (™ stripping, "EA SPORTS" prefixes, colons, remake vs
  // original name collisions).
  const matchBatches = await Promise.all(
    chunk(collapsed, TITLE_CHUNK).map((entries) =>
      (db as any).rpc('match_psn_games', {
        psn_titles: entries.map((e) => e.name),
        psn_np_comm_ids: entries.map((e) => e.npCommId),
      }),
    ),
  );

  type MatchRow = {
    id: string;
    title: string;
    psn_title: string;
    psn_np_communication_id: string | null;
    matched_by: 'id' | 'title';
  };
  const matches: MatchRow[] = [];
  const seenGameIds = new Set<string>();
  const titleBackfill: Array<{ game_id: string; np_comm_id: string }> = [];
  for (const { data, error } of matchBatches) {
    if (error) {
      console.error('[psn/sync-library] match_psn_games error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (data ?? []) as MatchRow[]) {
      if (seenGameIds.has(row.id)) continue;
      seenGameIds.add(row.id);
      matches.push(row);
      // Title match → record the npCommId on the game so every future sync
      // for every user hits the ID fast path. One backfill per game, forever.
      if (row.matched_by === 'title' && row.psn_np_communication_id) {
        titleBackfill.push({ game_id: row.id, np_comm_id: row.psn_np_communication_id });
      }
    }
  }

  // Fire-and-forget the backfill — it's a persistence optimization; sync must
  // not fail because an UPDATE did. Chunked to keep each request bounded.
  if (titleBackfill.length > 0) {
    (async () => {
      for (const { game_id, np_comm_id } of titleBackfill) {
        const { error } = await (db as any)
          .from('games')
          .update({ psn_np_communication_id: np_comm_id })
          .eq('id', game_id)
          .is('psn_np_communication_id', null);
        if (error) {
          console.error('[psn/sync-library] mapping backfill error (non-fatal):',
            JSON.stringify(error));
        }
      }
    })();
  }

  // IGDB auto-import pass — for PSN titles the DB matcher couldn't resolve,
  // try an IGDB search filtered by the entry's PSN platform. Narrowing by
  // platform disambiguates the collisions (SW Battlefront II 2017 is PS4-only,
  // Ratchet & Clank 2016 is PS4-only, etc.) so we only auto-import on a
  // single-hit result. Ambiguous (>1 hit) or no-hit → log for admin review.
  // Capped per-sync to keep us under Netlify's 10s budget.
  const matchedNpCommIds = new Set(
    matches.map((m) => m.psn_np_communication_id).filter((v): v is string => !!v),
  );
  const unmatchedCollapsed = collapsed.filter((c) => !matchedNpCommIds.has(c.npCommId));

  const autoImportCandidates = unmatchedCollapsed.slice(0, IGDB_AUTO_IMPORT_CAP);
  const deferredUnmatched = unmatchedCollapsed.slice(IGDB_AUTO_IMPORT_CAP);
  const toLog: typeof collapsed = [...deferredUnmatched];

  for (const entry of autoImportCandidates) {
    try {
      const platformId = IGDB_PLATFORM_BY_PSN[entry.platform];
      // Mirror the DB matcher's normalization: PSN's trophyTitleName often
      // includes ™®© (e.g. "Apex Legends™", "EA SPORTS™ College Football 25")
      // which IGDB's fuzzy `search` may or may not forgive. Stripping keeps
      // the auto-import consistent with how match_psn_games already handles
      // these characters.
      const searchName = entry.name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
      // `search` is IGDB's fuzzy name matcher. Platform + game-type filters
      // (main game / expansion / standalone / remake / remaster / expanded
      // game — same set as GAME_CATEGORY_OR_FILTER in utils/games.ts) drop
      // DLCs, bundles, and non-games that would pollute auto-import.
      const rows = await igdbFetch(
        'games',
        `
          search "${escapeIgdbString(searchName)}";
          fields id, name, platforms.id, game_type;
          where platforms = (${platformId}) & game_type = (0,2,4,8,9,10);
          limit 5;
        `,
      );
      const hits = Array.isArray(rows) ? rows : [];
      if (hits.length !== 1) {
        toLog.push(entry);
        continue;
      }
      const igdbId = Number(hits[0]?.id);
      if (!Number.isFinite(igdbId)) {
        toLog.push(entry);
        continue;
      }
      const result = await importGameByIgdbId(db, igdbId);
      if (!result.ok) {
        console.error('[psn/sync-library] auto-import failed:', entry.name, result.error);
        toLog.push(entry);
        continue;
      }
      // Record the mapping on the freshly imported row so the next sync hits
      // the ID path. Ignore errors — the game is imported either way; worst
      // case the next sync re-resolves via title.
      const { error: mapErr } = await (db as any)
        .from('games')
        .update({ psn_np_communication_id: entry.npCommId })
        .eq('id', result.game.id)
        .is('psn_np_communication_id', null);
      if (mapErr) {
        console.error('[psn/sync-library] auto-import mapping write error (non-fatal):',
          JSON.stringify(mapErr));
      }
      if (!seenGameIds.has(result.game.id)) {
        seenGameIds.add(result.game.id);
        matches.push({
          id: result.game.id,
          title: result.game.title,
          psn_title: entry.name,
          psn_np_communication_id: entry.npCommId,
          matched_by: 'id',
        });
      }
    } catch (e) {
      console.error('[psn/sync-library] IGDB search error for', entry.name, e);
      toLog.push(entry);
    }
  }

  // Log the leftovers so Sam/Bill can see what the matcher + IGDB pass missed
  // and manually import real games from an admin page. Fire-and-forget.
  if (toLog.length > 0) {
    (db as any).rpc('log_unmatched_psn_titles', {
      np_comm_ids: toLog.map((e) => e.npCommId),
      titles: toLog.map((e) => e.name),
      platforms: toLog.map((e) => e.platform),
    }).then(({ error }: any) => {
      if (error) {
        console.error('[psn/sync-library] log_unmatched_psn_titles error (non-fatal):',
          JSON.stringify(error));
      }
    });
  }

  if (matches.length === 0) {
    await (db as any).from('profiles').update({ psn_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: titles.length, total: titles.length });
  }

  // Resolve matched ids to canonical rows — ownership + trophy progress belong
  // on the main game, not the collapsed edition. Multiple editions collapsing
  // to the same canonical fold into one row; keep the most-recently-played
  // edition's PSN metadata (fallback: higher trophy progress %).
  const matchedGameIds = matches.map((m) => m.id);
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

  const collapsedByLowerName = new Map(collapsed.map((c) => [c.name.toLowerCase(), c]));

  type AggRow = {
    row: Record<string, unknown>;
    _lastPlayedTs: number;
    _bestProgress: number;
  };
  const perCanonical = new Map<string, AggRow>();
  for (const match of matches) {
    const psnEntry = collapsedByLowerName.get((match.psn_title ?? match.title).toLowerCase().trim());
    if (!psnEntry) continue;
    const canonicalId = canonicalOf.get(match.id) ?? match.id;
    const playtime = playtimeByLowerName.get(psnEntry.name.toLowerCase()) ?? null;
    const lastPlayedAt = playtime?.lastPlayed ?? psnEntry.lastUpdatedDateTime ?? null;
    const row: Record<string, unknown> = {
      psn_np_communication_id: psnEntry.npCommId,
      psn_platform: psnEntry.platform,
      psn_trophies_earned: psnEntry.earned,
      psn_trophies_total: psnEntry.total,
      psn_platinum_earned: psnEntry.hasPlatinum,
      psn_progress: psnEntry.progress,
      psn_playtime_minutes: playtime?.minutes ?? null,
      psn_last_played_at: lastPlayedAt,
    };
    const lastPlayedTs = lastPlayedAt ? Date.parse(lastPlayedAt) : 0;

    const existing = perCanonical.get(canonicalId);
    const beats =
      !existing ||
      lastPlayedTs > existing._lastPlayedTs ||
      (lastPlayedTs === existing._lastPlayedTs && psnEntry.progress > existing._bestProgress);
    if (beats) {
      perCanonical.set(canonicalId, {
        row,
        _lastPlayedTs: lastPlayedTs,
        _bestProgress: psnEntry.progress,
      });
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
