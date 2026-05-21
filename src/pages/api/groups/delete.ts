import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id } = await context.request.json();
  const db = getSupabaseAdmin() as any;

  const { data: group } = await db.from("groups")
    .select("created_by").eq("id", group_id).single();
  if (!group) return json({ error: "Group not found" }, 404);
  if (group.created_by !== profile.id) return json({ error: "Only the owner can delete the group" }, 403);

  const { error } = await db.from("groups").delete().eq("id", group_id);
  if (error) return json({ error: error.message }, 500);

  return json({ success: true });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
