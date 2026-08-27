import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { coerceLibraryRow, mapBackloggdStatus } from "../../../../utils/backloggd/parse";

// POST { rows: BacklogGameRow[] }
// Applies an uploaded Backloggd library export as user_game_status rows. Pure DB
// work (slug match against our catalogue, no IGDB), done in one request with
// internal chunking — mirrors how api/steam/import.ts works. Never overwrites a
// status the user already has for a game.
const MAX_ROWS = 5000;
const COOLDOWN_MS = 60_000;
const IN_CHUNK = 300;
const INSERT_CHUNK = 500;

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

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
  if (raw.length > MAX_ROWS) {
    return json({ error: `That's more than ${MAX_ROWS} games — please contact us.` }, 400);
  }

  // ── Cooldown (mirrors Steam) ──────────────────────────────────────────────
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

  // ── Normalise + dedupe by slug (keep first — scraper orders most-committed first) ──
  const bySlug = new Map<string, { game_slug: string; game_title: string; backloggd_status: string }>();
  for (const r of raw) {
    const row = coerceLibraryRow(r);
    if (row && !bySlug.has(row.game_slug)) bySlug.set(row.game_slug, row);
  }
  const rows = [...bySlug.values()];
  if (rows.length === 0) return json({ error: "None of the rows in that file were valid." }, 400);

  // ── Match slugs against our catalogue ────────────────────────────────────
  const slugToGameId = new Map<string, string>();
  for (const slugs of chunk(rows.map((r) => r.game_slug), IN_CHUNK)) {
    const { data, error } = await db.from("games").select("id, slug").in("slug", slugs);
    if (error) {
      console.error("[import/backloggd/library] game match error:", JSON.stringify(error));
      return json({ error: "Could not match games. Try again." }, 500);
    }
    for (const g of data ?? []) if (g.slug) slugToGameId.set(g.slug, g.id);
  }

  const matched = rows.filter((r) => slugToGameId.has(r.game_slug));
  const unmatched = rows.filter((r) => !slugToGameId.has(r.game_slug));

  // ── Which of those games does the user already have a status for? ────────
  const matchedGameIds = [...new Set(matched.map((r) => slugToGameId.get(r.game_slug)!))];
  const already = new Set<string>();
  for (const ids of chunk(matchedGameIds, IN_CHUNK)) {
    const { data } = await db
      .from("user_game_status")
      .select("game_id")
      .eq("profile_id", profile.id)
      .in("game_id", ids);
    for (const s of data ?? []) already.add(s.game_id);
  }

  // ── Build the inserts (new games only, one row per game) ────────────────
  const now = new Date().toISOString();
  const seenGame = new Set<string>();
  const toInsert: { profile_id: string; game_id: string; status: string; updated_at: string }[] = [];
  for (const r of matched) {
    const gameId = slugToGameId.get(r.game_slug)!;
    if (already.has(gameId) || seenGame.has(gameId)) continue;
    seenGame.add(gameId);
    const status = mapBackloggdStatus(r.backloggd_status);
    if (!status) continue;
    toInsert.push({ profile_id: profile.id, game_id: gameId, status, updated_at: now });
  }

  for (const part of chunk(toInsert, INSERT_CHUNK)) {
    // ignoreDuplicates: never clobber a status the user already has (covers the
    // race between the check above and here).
    const { error } = await db
      .from("user_game_status")
      .upsert(part, { onConflict: "profile_id,game_id", ignoreDuplicates: true });
    if (error) {
      console.error("[import/backloggd/library] status insert error:", JSON.stringify(error));
      return json({ error: "Could not save your library. Some may have been applied." }, 500);
    }
  }

  await db.from("profiles").update({ backloggd_synced_at: now }).eq("id", profile.id);

  return json({
    total: rows.length,
    matched: matched.length,
    applied: toInsert.length,
    already_set: matched.length - toInsert.length,
    unmatched: unmatched.length,
    unmatched_sample: unmatched.slice(0, 15).map((r) => r.game_title),
  });
};
