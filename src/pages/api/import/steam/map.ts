import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { importGameByIgdbId } from "../../../../utils/games";
import {
  importSteamReviewItem,
  type SteamImportItemInput,
} from "../../../../utils/steam-reviews/importItem";
import { loadOwnedJob, recountJob } from "../../../../utils/importJob";

// POST { item_id, igdb_id? , game_id? } -> resolve one needs_mapping Steam item.
// Either point at an existing Chekpoint game (game_id) or import from IGDB
// (igdb_id). One of the two is required. game_id wins if both are provided.
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

  const itemId = String(body?.item_id ?? "");
  const gameIdRaw = body?.game_id != null ? String(body.game_id) : "";
  const igdbIdRaw = body?.igdb_id != null ? String(body.igdb_id) : "";
  const igdbId = igdbIdRaw ? parseInt(igdbIdRaw, 10) : NaN;
  if (!itemId || (!gameIdRaw && (!igdbIdRaw || Number.isNaN(igdbId)))) {
    return json({ error: "Missing item_id and (game_id or igdb_id)." }, 400);
  }

  const { data: item } = await db
    .from("import_job_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return json({ error: "Item not found." }, 404);

  const job = await loadOwnedJob(db, profile.id, item.job_id);
  if (!job) return json({ error: "You don't own this import." }, 403);
  if (job.source !== "steam") {
    return json({ error: "This item isn't a Steam import." }, 409);
  }

  let matchedGame: { id: string; title: string; slug: string };
  if (gameIdRaw) {
    const { data: existing } = await db
      .from("games")
      .select("id, title, slug")
      .eq("id", gameIdRaw)
      .maybeSingle();
    if (!existing) return json({ error: "That game is no longer in Chekpoint." }, 404);
    matchedGame = { id: existing.id, title: existing.title, slug: existing.slug ?? "" };
  } else {
    const imported = await importGameByIgdbId(db, igdbId);
    if (!imported.ok) {
      return json({ error: imported.error || "Could not import that game." }, imported.status || 502);
    }
    matchedGame = { id: imported.game.id, title: imported.game.title, slug: imported.game.slug };
  }

  const input: SteamImportItemInput = {
    id: item.id,
    steam_appid: item.steam_appid,
    game_title: item.game_title ?? "",
    review_text: item.review_text,
    review_date: item.review_date,
    hours_at_review: item.hours_at_review,
    source_url: item.source_url ?? "",
    matched_game_id: matchedGame.id,
  };

  let outcome;
  try {
    outcome = await importSteamReviewItem(db, profile.id, input);
  } catch (e) {
    outcome = { status: "failed" as const, detail: e instanceof Error ? e.message : "error" };
  }

  await db
    .from("import_job_items")
    .update({
      status: outcome.status,
      matched_game_id: outcome.matched_game_id ?? matchedGame.id,
      review_id: outcome.review_id ?? null,
      detail: outcome.detail ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  const fresh = await recountJob(db, item.job_id);

  return json({
    status: outcome.status,
    game: matchedGame,
    job: fresh,
  });
};
