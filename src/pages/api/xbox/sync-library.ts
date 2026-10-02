import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import {
  fetchAllTitles,
  isXboxAuthInvalid,
  type XboxTitleSummary,
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

  const xboxNames = titles.map((t) => t.name).filter((n): n is string => !!n && n.length > 0);

  const matchBatches = await Promise.all(
    chunk(xboxNames, TITLE_CHUNK).map((batch) =>
      (db as any).rpc('match_xbox_games', { xbox_titles: batch }),
    ),
  );

  const matches: Array<{ id: string; title: string; xbox_title: string }> = [];
  const seenGameIds = new Set<string>();
  for (const { data, error } of matchBatches) {
    if (error) {
      console.error('[xbox/sync-library] match_xbox_games error:', JSON.stringify(error));
      return json({ error: 'Failed to match games.' }, 500);
    }
    for (const row of (data ?? []) as Array<{ id: string; title: string; xbox_title: string }>) {
      if (!seenGameIds.has(row.id)) {
        seenGameIds.add(row.id);
        matches.push(row);
      }
    }
  }

  if (matches.length === 0) {
    await (db as any).from('profiles').update({ xbox_synced_at: new Date().toISOString() }).eq('id', profile.id);
    return json({ matched: 0, updated: 0, unmatched: titles.length, total: titles.length });
  }

  const titlesByLowerName = new Map<string, XboxTitleSummary>();
  for (const t of titles) titlesByLowerName.set(t.name.toLowerCase().trim(), t);

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

  const toInsert: any[] = [];
  const toUpdate: Array<{ game_id: string; row: Record<string, unknown> }> = [];

  for (const match of matches) {
    const xt = titlesByLowerName.get((match.xbox_title ?? match.title).toLowerCase().trim());
    if (!xt) continue;
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
