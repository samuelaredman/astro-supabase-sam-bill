import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

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
