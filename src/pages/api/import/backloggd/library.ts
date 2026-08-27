import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { coerceLibraryRow, mapBackloggdStatus } from "../../../../utils/backloggd/parse";
import { matchOrImportGame } from "../../../../utils/backloggd/matchGame";

// POST { rows: BacklogGameRow[], cursor?: number }
// Applies an uploaded Backloggd library export as user_game_status rows. Games
// we don't have are imported from IGDB (slug -> IGDB slug -> title search), so
// this is chunked: the client re-POSTs the same `rows` with an advancing
// `cursor` until { done: true }. Never overwrites a status the user already set.
const MAX_ROWS = 5000;
const COOLDOWN_MS = 60_000;
const COUNT_LIMIT = 30; // rows processed per call
const IGDB_LIMIT = 10; // IGDB game imports per call (rate-limit guard)
const TIME_BUDGET_MS = 8000;
const IGDB_GAP_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const raw = Array.isArray(body?.rows) ? body.rows : Array.isArray(body) ? body : null;
  if (!raw) return json({ error: "The file doesn't contain a library export." }, 400);
  if (raw.length === 0) return json({ error: "No games found in that file." }, 400);
  if (raw.length > MAX_ROWS) return json({ error: `That's more than ${MAX_ROWS} games — please contact us.` }, 400);

  const cursor = Math.max(0, parseInt(String(body?.cursor ?? "0"), 10) || 0);

  // ── Normalise + dedupe by slug (stable order, so `cursor` is consistent across calls) ──
  const bySlug = new Map<string, { game_slug: string; game_title: string; release_year: number | null; backloggd_status: string }>();
  for (const r of raw) {
    const row = coerceLibraryRow(r);
    if (row && !bySlug.has(row.game_slug)) bySlug.set(row.game_slug, row);
  }
  const rows = [...bySlug.values()];
  if (rows.length === 0) return json({ error: "None of the rows in that file were valid." }, 400);

  // ── Cooldown — only on the first chunk ──
  if (cursor === 0) {
    const { data: me } = await db
      .from("profiles")
      .select("backloggd_synced_at")
      .eq("id", profile.id)
      .maybeSingle();
    if (me?.backloggd_synced_at) {
      const elapsed = Date.now() - new Date(me.backloggd_synced_at).getTime();
      if (elapsed < COOLDOWN_MS) {
        return json(
          { error: "You just synced — try again in a minute.", retry_after: Math.ceil((COOLDOWN_MS - elapsed) / 1000) },
          429,
        );
      }
    }
  }

  // ── Process a bounded slice ──
  const started = Date.now();
  const toUpsert: { profile_id: string; game_id: string; status: string; updated_at: string }[] = [];
  const seenGame = new Set<string>();
  const unmatchedSample: string[] = [];
  let processed = 0;
  let applied = 0;
  let already = 0;
  let unmatched = 0;
  let importedFromIgdb = 0;
  let igdbCalls = 0;
  let i = cursor;

  for (; i < rows.length; i++) {
    if (
      processed > 0 &&
      (processed >= COUNT_LIMIT || igdbCalls >= IGDB_LIMIT || Date.now() - started > TIME_BUDGET_MS)
    ) {
      break;
    }
    const row = rows[i];
    processed++;

    let match;
    try {
      match = await matchOrImportGame(db, {
        slug: row.game_slug,
        title: row.game_title,
        year: row.release_year,
      });
    } catch (e) {
      console.error("[import/backloggd/library] match error:", e instanceof Error ? e.message : e);
      match = null;
    }

    if (match?.imported) {
      importedFromIgdb++;
      igdbCalls++;
      await sleep(IGDB_GAP_MS);
    } else if (!match) {
      igdbCalls++; // a miss also cost IGDB lookups
    }

    if (!match) {
      unmatched++;
      if (unmatchedSample.length < 15) unmatchedSample.push(row.game_title);
      continue;
    }
    if (seenGame.has(match.gameId)) continue;
    seenGame.add(match.gameId);

    const { data: existing } = await db
      .from("user_game_status")
      .select("game_id")
      .eq("profile_id", profile.id)
      .eq("game_id", match.gameId)
      .maybeSingle();
    if (existing) {
      already++;
      continue;
    }

    const status = mapBackloggdStatus(row.backloggd_status);
    if (!status) continue;
    toUpsert.push({ profile_id: profile.id, game_id: match.gameId, status, updated_at: new Date().toISOString() });
  }

  if (toUpsert.length) {
    const { error } = await db
      .from("user_game_status")
      .upsert(toUpsert, { onConflict: "profile_id,game_id", ignoreDuplicates: true });
    if (error) {
      console.error("[import/backloggd/library] status upsert error:", JSON.stringify(error));
      return json({ error: "Could not save your library. Some may have been applied." }, 500);
    }
    applied = toUpsert.length;
  }

  const nextCursor = i;
  const done = nextCursor >= rows.length;
  if (done) {
    await db.from("profiles").update({ backloggd_synced_at: new Date().toISOString() }).eq("id", profile.id);
  }

  return json({
    processed,
    applied,
    already,
    unmatched,
    imported_from_igdb: importedFromIgdb,
    unmatched_sample: unmatchedSample,
    next_cursor: done ? null : nextCursor,
    total: rows.length,
    done,
  });
};
