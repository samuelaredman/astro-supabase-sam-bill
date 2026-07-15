import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";
import { notifyRecommendationPublished } from "../../../utils/recommendationPublish";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id, body, contains_spoilers, status } = await context.request.json();
  if (!recommendation_id) return json({ error: "recommendation_id is required." }, 400);
  if (body && body.trim().length > 5000) return json({ error: "Recommendation must be 5000 characters or fewer." }, 400);

  // Only the author can edit
  const { data: rec } = await (db as any)
    .from("recommendations")
    .select("id, profile_id, status, source_game_id, target_game_id")
    .eq("id", recommendation_id)
    .maybeSingle();

  if (!rec) return json({ error: "Recommendation not found." }, 404);
  if (rec.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  // Explicit status param wins; otherwise keep the row's current status (a plain edit).
  const targetStatus = status === "draft" || status === "published" ? status : rec.status ?? "published";

  // ── Saving draft edits: body optional. ──
  if (targetStatus === "draft") {
    const { error } = await (db as any)
      .from("recommendations")
      .update({ body: body?.trim() ?? "", contains_spoilers: contains_spoilers ?? false, status: "draft" })
      .eq("id", recommendation_id);
    if (error) {
      console.error("[recommendations/update] draft save error:", JSON.stringify(error));
      return json({ error: "Failed to save draft." }, 500);
    }
    return json({ success: true, status: "draft" });
  }

  // ── Published path (an ordinary edit, or a draft being published) ──
  if (!body?.trim()) return json({ error: "Add a few words on why this works." }, 400);

  const publishing = rec.status !== "published";

  // Enforce one published recommendation per directional game pair before flipping
  // status (friendlier than letting the partial unique index throw).
  if (publishing) {
    const { data: existingPublished } = await (db as any)
      .from("recommendations").select("id")
      .eq("profile_id", profile.id)
      .eq("source_game_id", rec.source_game_id)
      .eq("target_game_id", rec.target_game_id)
      .eq("status", "published")
      .neq("id", recommendation_id)
      .maybeSingle();
    if (existingPublished) return json({ error: "You've already made this recommendation." }, 409);
  }

  const updatePayload: Record<string, unknown> = {
    body: body.trim(),
    contains_spoilers: contains_spoilers ?? false,
  };
  if (publishing) updatePayload.status = "published";

  const { error } = await (db as any).from("recommendations").update(updatePayload).eq("id", recommendation_id);
  if (error) {
    console.error("[recommendations/update] update error:", JSON.stringify(error));
    return json({ error: "Failed to update recommendation." }, 500);
  }

  // Re-screen the edited body for explicit content (non-fatal)
  const moderationDone = classifyText(body.trim())
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "recommendation", targetId: recommendation_id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[recommendations/update] moderation error (non-fatal):", e));

  // Publishing a draft fires the follower notifications (a plain edit does not).
  if (publishing) {
    await notifyRecommendationPublished(db, { recommendationId: recommendation_id, profileId: profile.id });
  }

  await moderationDone;

  return json({ success: true, status: publishing ? "published" : rec.status, body: body.trim(), contains_spoilers: contains_spoilers ?? false });
};
