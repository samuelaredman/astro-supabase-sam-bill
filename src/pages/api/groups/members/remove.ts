import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, target_profile_id } = await context.request.json();
  const db = getSupabaseAdmin() as any;

  const { data: callerMembership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  const { data: targetMembership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", target_profile_id).single();
  if (!targetMembership) return json({ error: "Member not found" }, 404);
  if (targetMembership.role === "owner") return json({ error: "Cannot remove the owner" }, 400);
  if (callerMembership.role === "admin" && targetMembership.role === "admin") {
    return json({ error: "Admins cannot remove other admins" }, 403);
  }

  await db.from("group_members").delete().eq("group_id", group_id).eq("profile_id", target_profile_id);
  return json({ success: true });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
