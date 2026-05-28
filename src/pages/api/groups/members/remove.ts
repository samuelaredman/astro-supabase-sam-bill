import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

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

  const { group_id, target_profile_id } = await context.request.json();
  if (!group_id || !target_profile_id)
    return json({ error: "group_id and target_profile_id required" }, 400);

  const { data: callerMembership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!callerMembership) return json({ error: "Not a member of this group" }, 403);

  const isOwner = callerMembership.role === "owner";
  const isAdmin = callerMembership.role === "admin";

  // Check can_remove_members for custom role holders
  let hasRemoveMembers = false;
  if (!isOwner && !isAdmin && callerMembership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_remove_members").eq("id", callerMembership.custom_role_id).maybeSingle();
    hasRemoveMembers = !!cr?.can_remove_members;
  }

  if (!isOwner && !isAdmin && !hasRemoveMembers)
    return json({ error: "Not authorized" }, 403);

  const { data: targetMembership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", target_profile_id).maybeSingle();
  if (!targetMembership) return json({ error: "Member not found" }, 404);
  if (targetMembership.role === "owner") return json({ error: "Cannot remove the owner" }, 400);

  // Only the owner can remove admins
  if (!isOwner && targetMembership.role === "admin")
    return json({ error: "Cannot remove an admin" }, 403);

  const { error } = await db.from("group_members")
    .delete().eq("group_id", group_id).eq("profile_id", target_profile_id);
  if (error) {
    console.error("[groups/members/remove] error:", JSON.stringify(error));
    return json({ error: "Failed to remove member" }, 500);
  }

  // Clean up any outstanding invite for this user so they can be reinvited cleanly
  await db.from("group_invites").delete().eq("group_id", group_id).eq("invited_profile_id", target_profile_id);

  return json({ success: true });
};
