import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { loadOwnedJob, recountJob } from "../../../../utils/importJob";

// POST { item_id } -> mark a needs_mapping Steam item as skipped so it
// disappears from the import UI. Used when the game isn't in IGDB or our DB
// (non-game apps, delisted regional titles, etc.) and there's nothing sensible
// to match it against.
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
  if (!itemId) return json({ error: "Missing item_id." }, 400);

  const { data: item } = await db
    .from("import_job_items")
    .select("id, job_id, status")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return json({ error: "Item not found." }, 404);

  const job = await loadOwnedJob(db, profile.id, item.job_id);
  if (!job) return json({ error: "You don't own this import." }, 403);
  if (job.source !== "steam") {
    return json({ error: "This item isn't a Steam import." }, 409);
  }
  if (item.status !== "needs_mapping") {
    return json({ error: "Only unmatched items can be discarded." }, 409);
  }

  const { error } = await db
    .from("import_job_items")
    .update({
      status: "skipped",
      detail: "discarded by user",
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  if (error) {
    console.error("[import/steam/discard] update error:", JSON.stringify(error));
    return json({ error: "Could not discard that item." }, 500);
  }

  const fresh = await recountJob(db, item.job_id);
  return json({ ok: true, job: fresh });
};
