import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import {
  fetchAllTitles,
  isXboxAuthInvalid,
  type XboxTitleSummary,
  type XboxConsole,
} from "../../../utils/xbox";

const IN_CHUNK = 100;
const WRITE_CHUNK = 500;
const TITLE_CHUNK = 200;

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

  // Keep only titles with a usable titleId + name + platform. Drops anomalous
  // rows (pre-360 games, dev kits) that can't thread through either match
  // path cleanly.
  const validTitles = titles.filter(
    (t): t is XboxTitleSummary & { platform: XboxConsole } =>
      !!t.titleId && !!t.name && !!t.platform,
  );

  // Step 1 — titleId fast path via games.xbox_title_id. This column is new
  // (added by 20261111000002) and nearly empty in practice, so this match
  // typically returns ~0 rows today. Over time, the title-fallback path below
  // will seed it (via the PSN-style approach once we build Sony's Store
  // lookup, or admin curation in the interim).
  const xboxTitleIds = validTitles.map((t) => t.titleId);
  const titleIdBatches = await Promise.all(
    chunk(xboxTitleIds, TITLE_CHUNK).map((batch) =>
      (db as any).rpc('match_xbox_games_by_title_id', { xbox_title_ids: batch }),
    ),
  );

  type IdMatchRow = { id: string; xbox_title_id: string };
  const matches: Array<{ id: string; xbox_title_id: string }> = [];
  const seenGameIds = new Set<string>();
  for (const { data, error } of titleIdBatches) {
    if (error) {
      console.error('[xbox/sync-library] titleId match error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (data ?? []) as IdMatchRow[]) {
      if (!seenGameIds.has(row.id)) {
        seenGameIds.add(row.id);
        matches.push({ id: row.id, xbox_title_id: row.xbox_title_id });
      }
    }
  }

  // Step 2 — title fallback for everything the titleId path didn't resolve.
  // Uses the title-based matcher that was in place before PR #110 (restored
  // in 20261112000000 so it coexists with match_xbox_games_by_title_id).
  // Steam has the same two-step design; see steam/import.ts.
  const matchedTitleIds = new Set(matches.map((m) => m.xbox_title_id));
  const unmatchedEntries = validTitles.filter((t) => !matchedTitleIds.has(t.titleId));

  if (unmatchedEntries.length > 0) {
    const titleIdByLowerName = new Map<string, string>();
    for (const t of unmatchedEntries) {
      titleIdByLowerName.set(t.name.toLowerCase().trim(), t.titleId);
    }
    const unmatchedNames = unmatchedEntries.map((t) => t.name);

    const titleBatches = await Promise.all(
      chunk(unmatchedNames, TITLE_CHUNK).map((batch) =>
        (db as any).rpc('match_xbox_games', { xbox_titles: batch }),
      ),
    );

    type TitleMatchRow = { id: string; title: string; xbox_title: string };
    for (const { data, error } of titleBatches) {
      if (error) {
        console.error('[xbox/sync-library] title match error:', JSON.stringify(error));
        return json({ error: 'Failed to match games.' }, 500);
      }
      for (const row of (data ?? []) as TitleMatchRow[]) {
        if (seenGameIds.has(row.id)) continue;
        const titleId = titleIdByLowerName.get(
          (row.xbox_title ?? row.title).toLowerCase().trim(),
        );
        if (!titleId) continue;
        seenGameIds.add(row.id);
        matches.push({ id: row.id, xbox_title_id: titleId });
      }
    }
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
