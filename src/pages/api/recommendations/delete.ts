import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id } = await context.request.json();
  if (!recommendation_id) return json({ error: "recommendation_id is required." }, 400);

  const { data: rec } = await (db as any)
    .from("recommendations")
    .select("id, profile_id")
    .eq("id", recommendation_id)
    .maybeSingle();

  if (!rec) return json({ error: "Recommendation not found." }, 404);
  if (rec.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  // Remove notifications tied to this recommendation first. The FK is ON DELETE SET NULL,
  // which would otherwise leave orphaned rows that render the "a recommendation" fallback.
  try {
    await (db as any).from("notifications").delete().eq("recommendation_id", recommendation_id);
  } catch (e) {
    console.error("[recommendations/delete] notification cleanup error (non-fatal):", e);
  }

  const { error } = await (db as any).from("recommendations").delete().eq("id", recommendation_id);

  if (error) {
    console.error("[recommendations/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete recommendation." }, 500);
  }

  return json({ success: true });
};
