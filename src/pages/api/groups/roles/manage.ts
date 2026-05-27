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

  const body = await context.request.json();
  const {
    group_id, action, role_id, name, color, role_rank,
    can_invite, can_remove_members, can_edit_group,
    can_manage_sessions, can_manage_watchlist, can_manage_roles,
    is_view_only,
  } = body;

  if (!group_id) return json({ error: "group_id required" }, 400);
  if (!["create", "update", "delete"].includes(action))
    return json({ error: "action must be create, update, or delete" }, 400);

  // ── Resolve caller's authority ────────────────────────────────────────────
  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  const isOwner = membership.role === "owner";
  const isAdmin = membership.role === "admin";

  // Fetch caller's own custom role (needed for rank checks + self-protection)
  let callerCustomRole: any = null;
  if (membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("id, role_rank, can_manage_roles")
      .eq("id", membership.custom_role_id).maybeSingle();
    callerCustomRole = cr;
  }

  // Access: owner, admin, or custom role with can_manage_roles
  if (!isOwner && !isAdmin && !callerCustomRole?.can_manage_roles)
    return json({ error: "Not authorized to manage roles" }, 403);

  // Rank constraint for non-owner, non-admin custom role holders.
  // null = no rank restriction (owner or admin).
  const callerRank: number | null = (isOwner || isAdmin)
    ? null
    : (callerCustomRole?.role_rank ?? 9999);

  // ── Helper: rank guard for create/edit ───────────────────────────────────
  function validateNewRank(r: any): Response | null {
    const rank = typeof r === "number" ? r : 100;
    if (rank < 1) return json({ error: "Role rank must be at least 1 (0 is reserved for the owner)" }, 400);
    if (callerRank !== null && rank <= callerRank)
      return json({ error: `Role rank must be greater than your own rank (${callerRank})` }, 403);
    return null;
  }

  // ── Create ───────────────────────────────────────────────────────────────
  if (action === "create") {
    if (!name?.trim()) return json({ error: "Role name required" }, 400);
    const rankErr = validateNewRank(role_rank);
    if (rankErr) return rankErr;
    const finalRank = typeof role_rank === "number" ? role_rank : 100;

    const { data: role, error } = await db.from("group_roles").insert({
      group_id,
      name:                 name.trim(),
      color:                color ?? "#6050c8",
      role_rank:            finalRank,
      can_manage_roles:     !!can_manage_roles,
      can_invite:           !!can_invite,
      can_remove_members:   !!can_remove_members,
      can_edit_group:       !!can_edit_group,
      can_manage_sessions:  can_manage_sessions !== undefined ? !!can_manage_sessions : true,
      can_manage_watchlist: can_manage_watchlist !== undefined ? !!can_manage_watchlist : true,
      is_view_only:         !!is_view_only,
    }).select("id, name, color, role_rank, can_manage_roles, can_invite, can_remove_members, can_edit_group, can_manage_sessions, can_manage_watchlist, is_view_only").single();

    if (error) {
      if (error.code === "23505") return json({ error: "A role with that name already exists" }, 409);
      if (error.code === "23514") return json({ error: "Role rank must be at least 1" }, 400);
      console.error("[groups/roles/manage] create:", JSON.stringify(error));
      return json({ error: "Failed to create role" }, 500);
    }
    return json({ success: true, role });
  }

  // ── Update ───────────────────────────────────────────────────────────────
  if (action === "update") {
    if (!role_id) return json({ error: "role_id required" }, 400);

    // Self-protection: non-owners cannot edit their own role
    if (!isOwner && callerCustomRole?.id === role_id)
      return json({ error: "You cannot edit the role you currently hold" }, 403);

    // Rank check: non-owner, non-admin can only edit roles below their rank
    if (callerRank !== null) {
      const { data: targetRole } = await db.from("group_roles")
        .select("role_rank").eq("id", role_id).eq("group_id", group_id).maybeSingle();
      if (!targetRole) return json({ error: "Role not found" }, 404);
      if (targetRole.role_rank <= callerRank)
        return json({ error: "You can only edit roles with a rank lower than your own" }, 403);
    }

    const updates: Record<string, any> = {};
    if (name !== undefined)                 updates.name                = name.trim();
    if (color !== undefined)                updates.color               = color;
    if (can_invite !== undefined)           updates.can_invite          = !!can_invite;
    if (can_remove_members !== undefined)   updates.can_remove_members  = !!can_remove_members;
    if (can_edit_group !== undefined)       updates.can_edit_group      = !!can_edit_group;
    if (can_manage_sessions !== undefined)  updates.can_manage_sessions = !!can_manage_sessions;
    if (can_manage_watchlist !== undefined) updates.can_manage_watchlist= !!can_manage_watchlist;
    if (can_manage_roles !== undefined)     updates.can_manage_roles    = !!can_manage_roles;
    if (is_view_only !== undefined)         updates.is_view_only        = !!is_view_only;

    // Validate new rank if provided
    if (role_rank !== undefined) {
      const rankErr = validateNewRank(role_rank);
      if (rankErr) return rankErr;
      updates.role_rank = role_rank;
    }

    if (Object.keys(updates).length === 0) return json({ error: "No fields to update" }, 400);

    const { error } = await db.from("group_roles")
      .update(updates).eq("id", role_id).eq("group_id", group_id);
    if (error) {
      if (error.code === "23505") return json({ error: "A role with that name already exists" }, 409);
      if (error.code === "23514") return json({ error: "Role rank must be at least 1" }, 400);
      console.error("[groups/roles/manage] update:", JSON.stringify(error));
      return json({ error: "Failed to update role" }, 500);
    }
    return json({ success: true });
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  if (action === "delete") {
    if (!role_id) return json({ error: "role_id required" }, 400);

    // Self-protection: non-owners cannot delete their own role
    if (!isOwner && callerCustomRole?.id === role_id)
      return json({ error: "You cannot delete the role you currently hold" }, 403);

    // Rank check
    if (callerRank !== null) {
      const { data: targetRole } = await db.from("group_roles")
        .select("role_rank").eq("id", role_id).eq("group_id", group_id).maybeSingle();
      if (!targetRole) return json({ error: "Role not found" }, 404);
      if (targetRole.role_rank <= callerRank)
        return json({ error: "You can only delete roles with a rank lower than your own" }, 403);
    }

    // Clear the role from all members who had it, then delete
    await db.from("group_members")
      .update({ custom_role_id: null }).eq("custom_role_id", role_id).eq("group_id", group_id);
    const { error } = await db.from("group_roles")
      .delete().eq("id", role_id).eq("group_id", group_id);
    if (error) {
      console.error("[groups/roles/manage] delete:", JSON.stringify(error));
      return json({ error: "Failed to delete role" }, 500);
    }
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, 400);
};
