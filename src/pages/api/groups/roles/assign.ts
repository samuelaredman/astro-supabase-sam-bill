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

  const { group_id, target_profile_id, custom_role_id } = await context.request.json();
  if (!group_id || !target_profile_id)
    return json({ error: "group_id and target_profile_id required" }, 400);

  // ── Resolve caller's authority ────────────────────────────────────────────
  const { data: callerMembership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!callerMembership) return json({ error: "Not a member of this group" }, 403);

  const isOwner = callerMembership.role === "owner";
  const isAdmin = callerMembership.role === "admin";

  // ── Owner path: unrestricted (but still verify role belongs to this group) ─
  if (isOwner) {
    if (custom_role_id) {
      const { data: role } = await db.from("group_roles")
        .select("id").eq("id", custom_role_id).eq("group_id", group_id).maybeSingle();
      if (!role) return json({ error: "Role not found in this group" }, 404);
    }
    // fall through to the update below
  } else {
    // ── Non-owner enforcement ─────────────────────────────────────────────

    // All non-owners: cannot modify themselves
    if (target_profile_id === profile.id)
      return json({ error: "You cannot modify your own role assignment" }, 403);

    // Fetch target's current membership
    const { data: targetMembership } = await db.from("group_members")
      .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", target_profile_id).maybeSingle();
    if (!targetMembership) return json({ error: "Target is not a member of this group" }, 404);

    // Nobody (except owner) can touch the owner
    if (targetMembership.role === "owner")
      return json({ error: "Cannot modify the group owner's role assignment" }, 403);

    if (isAdmin) {
      // Admin cannot touch other admins (peer protection)
      if (targetMembership.role === "admin")
        return json({ error: "Admins cannot modify another admin's role assignment" }, 403);
      // Admin can assign any custom role to plain members — verify role belongs to group
      if (custom_role_id) {
        const { data: role } = await db.from("group_roles")
          .select("id").eq("id", custom_role_id).eq("group_id", group_id).maybeSingle();
        if (!role) return json({ error: "Role not found in this group" }, 404);
      }
      // fall through to the update below
    } else {
      // ── Custom role with can_manage_roles ──────────────────────────────
      let callerCustomRole: any = null;
      if (callerMembership.custom_role_id) {
        const { data: cr } = await db.from("group_roles")
          .select("role_rank, can_manage_roles").eq("id", callerMembership.custom_role_id).maybeSingle();
        callerCustomRole = cr;
      }
      if (!callerCustomRole?.can_manage_roles)
        return json({ error: "Not authorized to assign roles" }, 403);

      const callerRank: number = callerCustomRole.role_rank;

      // Cannot touch admins
      if (targetMembership.role === "admin")
        return json({ error: "Cannot modify an admin's role assignment" }, 403);

      // Determine target's effective rank
      let targetRank = 9999; // plain member with no custom role = lowest authority
      if (targetMembership.custom_role_id) {
        const { data: targetCustomRole } = await db.from("group_roles")
          .select("role_rank").eq("id", targetMembership.custom_role_id).maybeSingle();
        if (targetCustomRole) targetRank = targetCustomRole.role_rank;
      }

      // Target must have strictly lower authority (higher rank number)
      if (targetRank <= callerRank)
        return json({ error: "You can only modify members with a lower rank than your own" }, 403);

      // The role being assigned must also be lower authority than caller
      if (custom_role_id) {
        const { data: roleToAssign } = await db.from("group_roles")
          .select("role_rank").eq("id", custom_role_id).eq("group_id", group_id).maybeSingle();
        if (!roleToAssign) return json({ error: "Role not found in this group" }, 404);
        if (roleToAssign.role_rank <= callerRank)
          return json({ error: "You can only assign roles with a lower rank than your own" }, 403);
      }
    }
  }

  // ── Apply the assignment ──────────────────────────────────────────────────
  const { error } = await db.from("group_members")
    .update({ custom_role_id: custom_role_id ?? null })
    .eq("group_id", group_id)
    .eq("profile_id", target_profile_id);

  if (error) {
    console.error("[groups/roles/assign] error:", JSON.stringify(error));
    return json({ error: "Failed to assign role" }, 500);
  }

  return json({ success: true });
};
