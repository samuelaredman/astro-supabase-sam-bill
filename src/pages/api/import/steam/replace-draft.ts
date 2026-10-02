import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { clampImportedDateIso, loadOwnedJob, recountJob } from "../../../../utils/importJob";
import { resolvePCPlatformId } from "../../../../utils/steam-reviews/importItem";

// POST { item_id } -> for a skipped Steam item whose conflict is a DRAFT,
// delete the user's existing draft and insert the Steam text as a new draft.
// Refuses if the conflict is against a published review (that's destructive
// in a way the user probably doesn't want — publish/unpublish is their move).
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
    .select("*")
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
  if (!item.matched_game_id || !item.review_id) {
    return json({ error: "Missing conflict target." }, 409);
  }

  // Re-verify the existing review is still a draft owned by this user before
  // touching it — the client's view could be stale (user published it in
  // another tab, deleted it, etc). Same reason we DON'T just delete by id.
  const { data: existing } = await db
    .from("reviews")
    .select("id, status, profile_id, game_id")
    .eq("id", item.review_id)
    .maybeSingle();
  if (!existing) return json({ error: "Your original review is gone. Nothing to replace." }, 404);
  if (existing.profile_id !== profile.id) return json({ error: "Not your review." }, 403);
  if (existing.status !== "draft") {
    return json({ error: "Your review has been published — replace was cancelled." }, 409);
  }

  const { error: delError } = await db
    .from("reviews")
    .delete()
    .eq("id", existing.id)
    .eq("profile_id", profile.id);
  if (delError) {
    console.error("[import/steam/replace-draft] delete error:", JSON.stringify(delError));
    return json({ error: "Could not remove the old draft." }, 500);
  }

  const platformId = await resolvePCPlatformId(db);
  const dateIso = clampImportedDateIso(item.review_date);
  const playTimeHours =
    item.hours_at_review != null && Number.isFinite(item.hours_at_review)
      ? Math.max(0, Math.round(item.hours_at_review))
      : null;

  const { data: inserted, error: insError } = await db
    .from("reviews")
    .insert({
      profile_id: profile.id,
      game_id: item.matched_game_id,
      score: null,
      title: null,
      body: item.review_text,
      status: "draft",
      platform_played_on: platformId,
      play_time_hours: playTimeHours,
      contains_spoilers: false,
      published_at: null,
      ...(dateIso ? { created_at: dateIso } : {}),
    })
    .select("id")
    .single();
  if (insError || !inserted) {
    console.error("[import/steam/replace-draft] insert error:", JSON.stringify(insError));
    return json({ error: "Old draft was removed, but the new one failed to save." }, 500);
  }

  await db
    .from("import_job_items")
    .update({
      status: "drafted",
      review_id: inserted.id,
      detail: "replaced existing draft",
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  const fresh = await recountJob(db, item.job_id);
  return json({ ok: true, review_id: inserted.id, job: fresh });
};
