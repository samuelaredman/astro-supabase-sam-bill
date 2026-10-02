import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { loadOwnedJob, recountJob } from "../../../../utils/importJob";

// POST { item_id } -> "Keep mine" on a Steam draft conflict. Records the
// appid as dismissed so future re-imports never surface this conflict again,
// and clears the item's detail so the current session's status poll drops it
// from `skipped_conflicts`.
//
// Only meaningful for draft conflicts — identical/published summary rows are
// informational and don't have a dismiss button in the current UI. Guarding
// on `conflict:draft` here keeps a future UI change from silently dismissing
// summary appids the user never got a chance to reconsider.
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
    .select("id, job_id, status, detail, steam_appid")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return json({ error: "Item not found." }, 404);

  const job = await loadOwnedJob(db, profile.id, item.job_id);
  if (!job) return json({ error: "You don't own this import." }, 403);
  if (job.source !== "steam") {
    return json({ error: "This item isn't a Steam import." }, 409);
  }
  if (item.status !== "skipped" || item.detail !== "conflict:draft") {
    return json({ error: "This item isn't a draft conflict." }, 409);
  }
  if (!item.steam_appid) {
    return json({ error: "Missing Steam appid on this item." }, 409);
  }

  // Upsert — if the user already dismissed this appid (e.g. from a prior
  // import), the PK conflict just no-ops on the ignoreDuplicates path. We
  // still want to update the item's detail below so the current session's
  // panel drops the card either way.
  const { error: dismissErr } = await db
    .from("steam_import_dismissals")
    .upsert(
      {
        profile_id: profile.id,
        steam_appid: item.steam_appid,
        dismissed_via: "keep_mine",
      },
      { onConflict: "profile_id,steam_appid", ignoreDuplicates: true },
    );
  if (dismissErr) {
    console.error("[import/steam/dismiss] upsert error:", JSON.stringify(dismissErr));
    return json({ error: "Could not record the dismissal." }, 500);
  }

  // Rewrite detail so status.ts's `.like("detail", "conflict:%")` filter
  // excludes it — the panel drops the card without a page reload.
  const { error: updateErr } = await db
    .from("import_job_items")
    .update({
      detail: "dismissed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (updateErr) {
    console.error("[import/steam/dismiss] item update error:", JSON.stringify(updateErr));
    // Dismissal is already recorded — the future-import guard works. Only
    // this session's UI is stale, and a page refresh would fix it.
    return json({ ok: true, warning: "Dismissed, but the panel may not update until refresh." });
  }

  const fresh = await recountJob(db, item.job_id);
  return json({ ok: true, job: fresh });
};
