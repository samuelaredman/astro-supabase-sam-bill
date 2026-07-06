import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id, body, contains_spoilers } = await context.request.json();
  if (!recommendation_id || !body?.trim()) return json({ error: "recommendation_id and body are required." }, 400);
  if (body.trim().length > 5000) return json({ error: "Recommendation must be 5000 characters or fewer." }, 400);

  // Only the author can edit
  const { data: rec } = await (db as any)
    .from("recommendations")
    .select("id, profile_id")
    .eq("id", recommendation_id)
    .maybeSingle();

  if (!rec) return json({ error: "Recommendation not found." }, 404);
  if (rec.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error } = await (db as any)
    .from("recommendations")
    .update({ body: body.trim(), contains_spoilers: contains_spoilers ?? false })
    .eq("id", recommendation_id);

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

  await moderationDone;

  return json({ success: true, body: body.trim(), contains_spoilers: contains_spoilers ?? false });
};
