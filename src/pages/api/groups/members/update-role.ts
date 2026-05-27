import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, target_profile_id, role } = await context.request.json();
  if (!["admin", "member"].includes(role)) return json({ error: "role must be admin or member" }, 400);

  const { data: callerMembership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!callerMembership || callerMembership.role !== "owner") {
    return json({ error: "Only the owner can change roles" }, 403);
  }

  if (target_profile_id === profile.id) return json({ error: "Cannot change your own role" }, 400);

  const { error } = await db.from("group_members")
    .update({ role }).eq("group_id", group_id).eq("profile_id", target_profile_id);
  if (error) return json({ error: error.message }, 500);

  return json({ success: true });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
