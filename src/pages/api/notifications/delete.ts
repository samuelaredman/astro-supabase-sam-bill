import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { notification_id } = body;
  if (!notification_id) return json({ error: "notification_id required" }, 400);

  const { error } = await db
    .from("notifications")
    .delete()
    .eq("id", notification_id)
    .eq("profile_id", profile.id); // ownership check — can only delete your own

  if (error) {
    console.error("[notifications/delete] error:", JSON.stringify(error));
    return json({ error: "Failed to delete notification" }, 500);
  }

  return json({ success: true });
};
