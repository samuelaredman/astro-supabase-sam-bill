import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import {
  fetchAllTitles,
  isXboxAuthInvalid,
  type XboxTitleSummary,
  type XboxConsole,
} from "../../../utils/xbox";
import { igdbFetch, escapeIgdbString } from "../../../utils/igdb";
import { importGameByIgdbId } from "../../../utils/games";

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

// Per-sync cap on IGDB-driven imports (see PSN sync-library.ts for context).
const IGDB_AUTO_IMPORT_CAP = 10;

// Xbox console → IGDB platform id. Narrowing by platform resolves the same
// class of same-title re-release collisions PSN hits (e.g. Gears of War on
// Xbox 360 vs Xbox One Ultimate Edition). Xbox 360 = 12, Xbox One = 49,
// Xbox Series X|S = 169 in IGDB.
const IGDB_PLATFORM_BY_XBOX: Record<XboxConsole, number> = {
  'Xbox 360': 12,
  'Xbox One': 49,
  'Xbox Series X|S': 169,
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { data: profileData } = await (db as any)
    .from('profiles')
    .select('xbox_xuid, xbox_api_key, xbox_synced_at')
    .eq('id', profile.id)
    .single();

  if (!profileData?.xbox_xuid || !profileData?.xbox_api_key) {
    return json({ error: 'No Xbox account connected.' }, 400);
  }

  // Same 1-minute cooldown as Steam / PSN.
  if (profileData.xbox_synced_at) {
    const secondsSince = (Date.now() - new Date(profileData.xbox_synced_at).getTime()) / 1000;
    if (secondsSince < 60) {
      const wait = Math.ceil(60 - secondsSince);
      return json({ error: `Please wait ${wait}s before syncing again.` }, 429);
    }
  }

  let titles: XboxTitleSummary[];
  try {
    titles = await fetchAllTitles(profileData.xbox_api_key, profileData.xbox_xuid);
  } catch (e) {
    if (isXboxAuthInvalid(e)) {
      return json({
        error: 'Your Xbox API key is no longer valid. Reconnect from Settings.',
        needsReconnect: true,
      }, 401);
    }
    console.error('[xbox/sync-library] fetchAllTitles error:', e);
    return json({ error: 'Xbox Live is temporarily unavailable. Try again in a minute.' }, 502);
  }

  if (titles.length === 0) {
    await (db as any).from('profiles').update({ xbox_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: 0, total: 0 });
  }

  // Keep only titles with a usable titleId + name + platform — everything the
  // ID matcher and IGDB auto-import both need. Drops anomalous rows (pre-360
  // games, dev kits) rather than threading nulls through the pipeline.
  const validTitles = titles.filter(
    (t): t is XboxTitleSummary & { platform: XboxConsole } =>
      !!t.titleId && !!t.name && !!t.platform,
  );

  // Match by titleId against games.xbox_title_id. Previously the matcher did
  // normalized title + trigram fuzzy matching — same class of bug fixed on
  // PSN in 20261111000001 (demonstrated by the Ratchet & Clank 2002-vs-2016
  // case). Xbox doesn't have a pre-populated ID bridge the way Steam does
  // (via game_steam_apps), so the IGDB auto-import pass below seeds it on
  // first-sight games, same pattern as PSN sync-library.ts.
  const xboxTitleIds = validTitles.map((t) => t.titleId);
  const matchBatches = await Promise.all(
    chunk(xboxTitleIds, TITLE_CHUNK).map((batch) =>
      (db as any).rpc('match_xbox_games', { xbox_title_ids: batch }),
    ),
  );

  type MatchRow = { id: string; xbox_title_id: string };
  const matches: MatchRow[] = [];
  const seenGameIds = new Set<string>();
  for (const { data, error } of matchBatches) {
    if (error) {
      console.error('[xbox/sync-library] match_xbox_games error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (data ?? []) as MatchRow[]) {
      if (!seenGameIds.has(row.id)) {
        seenGameIds.add(row.id);
        matches.push(row);
      }
    }
  }

  // IGDB auto-import pass with layered filters (platform + allowed game_type
  // + first_release_date upper bound) — same shape as PSN sync-library.ts.
  // The lastPlayed timestamp caps the release date: a user can't have earned
  // gamerscore before the game released. Single-hit only; 0 or 2+ → admin log.
  const matchedTitleIds = new Set(matches.map((m) => m.xbox_title_id));
  const unmatchedTitles = validTitles.filter((t) => !matchedTitleIds.has(t.titleId));

  const autoImportCandidates = unmatchedTitles.slice(0, IGDB_AUTO_IMPORT_CAP);
  const deferredUnmatched = unmatchedTitles.slice(IGDB_AUTO_IMPORT_CAP);
  type ToLog = typeof validTitles[number];
  const toLog: ToLog[] = [...deferredUnmatched];

  for (const entry of autoImportCandidates) {
    try {
      const platformId = IGDB_PLATFORM_BY_XBOX[entry.platform];
      const searchName = entry.name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
      const lastPlayedUnix = entry.lastPlayed
        ? Math.floor(new Date(entry.lastPlayed).getTime() / 1000)
        : null;
      const dateClause = Number.isFinite(lastPlayedUnix as number)
        ? ` & first_release_date <= ${lastPlayedUnix}`
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
        console.error('[xbox/sync-library] auto-import failed:', entry.name, result.error);
        toLog.push(entry);
        continue;
      }
      const { error: mapErr } = await (db as any)
        .from('games')
        .update({ xbox_title_id: entry.titleId })
        .eq('id', result.game.id)
        .is('xbox_title_id', null);
      if (mapErr) {
        console.error('[xbox/sync-library] mapping write error (non-fatal):', JSON.stringify(mapErr));
      }
      if (!seenGameIds.has(result.game.id)) {
        seenGameIds.add(result.game.id);
        matches.push({ id: result.game.id, xbox_title_id: entry.titleId });
      }
    } catch (e) {
      console.error('[xbox/sync-library] IGDB search error for', entry.name, e);
      toLog.push(entry);
    }
  }

  if (toLog.length > 0) {
    (db as any).rpc('log_unmatched_xbox_titles', {
      title_ids: toLog.map((e) => e.titleId),
      titles: toLog.map((e) => e.name),
      platforms: toLog.map((e) => e.platform),
    }).then(({ error }: any) => {
      if (error) {
        console.error('[xbox/sync-library] log_unmatched_xbox_titles error (non-fatal):',
          JSON.stringify(error));
      }
    });
  }

  if (matches.length === 0) {
    await (db as any).from('profiles').update({ xbox_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: titles.length, total: titles.length });
  }

  // Map titleId → Xbox summary so the aggregate loop below can read
  // gamerscore / lastPlayed off the source row without a second lookup.
  const titlesByTitleId = new Map<string, XboxTitleSummary>();
  for (const t of validTitles) titlesByTitleId.set(t.titleId, t);

  // Resolve matched ids to their canonical rows — a title that matches a
  // collapsed edition records ownership on the main game. Multiple editions
  // collapsing into the same canonical fold into one row; pick the
  // most-recently-played edition's Xbox metadata (fallback: highest gamerscore).
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

  type AggRow = {
    row: Record<string, unknown>;
    _lastPlayedTs: number;
    _bestGamerscore: number;
  };
  const perCanonical = new Map<string, AggRow>();
  for (const match of matches) {
    const xt = titlesByTitleId.get(match.xbox_title_id);
    if (!xt) continue;
    const canonicalId = canonicalOf.get(match.id) ?? match.id;
    const progress = xt.maxGamerscore > 0
      ? Math.round((xt.currentGamerscore / xt.maxGamerscore) * 100)
      : 0;
    const row: Record<string, unknown> = {
      xbox_title_id: xt.titleId,
      xbox_platform: xt.platform,
      xbox_current_gamerscore: xt.currentGamerscore,
      xbox_max_gamerscore: xt.maxGamerscore,
      xbox_progress: progress,
      xbox_last_played_at: xt.lastPlayed,
    };
    const lastPlayedTs = xt.lastPlayed ? Date.parse(xt.lastPlayed) : 0;

    const existing = perCanonical.get(canonicalId);
    const beats =
      !existing ||
      lastPlayedTs > existing._lastPlayedTs ||
      (lastPlayedTs === existing._lastPlayedTs && xt.currentGamerscore > existing._bestGamerscore);
    if (beats) {
      perCanonical.set(canonicalId, {
        row,
        _lastPlayedTs: lastPlayedTs,
        _bestGamerscore: xt.currentGamerscore,
      });
    }
  }

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
      console.error('[xbox/sync-library] insert error:', JSON.stringify(insertError));
      return json({ error: 'Failed to save game statuses.' }, 500);
    }
  }

  for (const { game_id, row } of toUpdate) {
    const { error: updateError } = await (db as any)
      .from('user_game_status')
      .update(row)
      .eq('profile_id', profile.id)
      .eq('game_id', game_id);
    if (updateError) {
      console.error('[xbox/sync-library] update error (non-fatal):', JSON.stringify(updateError));
    }
  }

  await (db as any).from('profiles').update({ xbox_synced_at: new Date().toISOString() }).eq('id', profile.id);

  return json({
    matched: toInsert.length,
    updated: toUpdate.length,
    unmatched: titles.length - matches.length,
    total: titles.length,
  });
};
