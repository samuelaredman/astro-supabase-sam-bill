import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { importGameByIgdbId } from "../../../../utils/games";
import { importBacklogItem, type ImportItemInput } from "../../../../utils/backloggd/importItem";
import { loadOwnedJob, recountJob } from "../../../../utils/backloggd/job";

// POST { item_id, igdb_id } -> resolve one needs_mapping item: import the chosen
// IGDB game, then run the normal per-item insert against it.
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
  const igdbId = parseInt(String(body?.igdb_id ?? ""), 10);
  if (!itemId || !igdbId || Number.isNaN(igdbId)) {
    return json({ error: "Missing item_id or igdb_id." }, 400);
  }

  const { data: item } = await db
    .from("import_job_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return json({ error: "Item not found." }, 404);

  const job = await loadOwnedJob(db, profile.id, item.job_id);
  if (!job) return json({ error: "You don't own this import." }, 403);

  const imported = await importGameByIgdbId(db, igdbId);
  if (!imported.ok) {
    return json({ error: imported.error || "Could not import that game." }, imported.status || 502);
  }

  const input: ImportItemInput = {
    id: item.id,
    game_slug: item.game_slug,
    game_title: item.game_title,
    release_year: item.release_year,
    rating: item.rating,
    review_text: item.review_text,
    review_date: item.review_date,
    platform_name: item.platform_name,
    contains_spoilers: item.contains_spoilers,
    source_url: item.source_url ?? "",
    matched_game_id: imported.game.id,
  };

  let outcome;
  try {
    outcome = await importBacklogItem(db, profile.id, input);
  } catch (e) {
    outcome = { status: "failed" as const, detail: e instanceof Error ? e.message : "error" };
  }

  await db
    .from("import_job_items")
    .update({
      status: outcome.status,
      matched_game_id: outcome.matched_game_id ?? imported.game.id,
      review_id: outcome.review_id ?? null,
      detail: outcome.detail ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  const fresh = await recountJob(db, item.job_id);

  return json({
    status: outcome.status,
    game: { id: imported.game.id, title: imported.game.title, slug: imported.game.slug },
    job: fresh,
  });
};
