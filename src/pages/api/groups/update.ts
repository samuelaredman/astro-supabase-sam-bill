import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

function randomCode(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, name, description, visibility, regenerate_invite, join_prompt, stats_config } = body;

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not authorized" }, 403);

  const isOwner = membership.role === "owner";
  const isAdmin = membership.role === "admin";

  // Custom role holders with can_edit_group may update name/description/join_prompt/stats_config
  let hasEditGroup = false;
  if (!isOwner && !isAdmin && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    hasEditGroup = !!cr?.can_edit_group;
  }

  if (!isOwner && !isAdmin && !hasEditGroup)
    return json({ error: "Not authorized" }, 403);

  const updates: Record<string, any> = {};

  if (name !== undefined)         updates.name        = name.trim();
  if (description !== undefined)  updates.description = description?.trim() || null;
  if (join_prompt !== undefined)  updates.join_prompt = join_prompt?.trim() || null;
  if (stats_config !== undefined) updates.stats_config = stats_config;

  // Visibility and invite regeneration require at least owner/admin
  if (visibility !== undefined && !isOwner && !isAdmin)
    return json({ error: "Only the group owner or admin can change visibility" }, 403);
  if (regenerate_invite && !isOwner && !isAdmin)
    return json({ error: "Only the group owner or admin can regenerate the invite code" }, 403);

  if (visibility !== undefined) {
    if (!["public", "private", "community"].includes(visibility))
      return json({ error: "Invalid visibility" }, 400);
    if (visibility === "community") {
      const { data: prof } = await db.from("profiles")
        .select("is_group_admin").eq("id", profile.id).single();
      if (!prof?.is_group_admin)
        return json({ error: "Only admins can set Community visibility" }, 403);
    }
    updates.visibility = visibility;
    if (visibility === "private") {
      const { data: g } = await db.from("groups").select("invite_code").eq("id", group_id).single();
      if (!g?.invite_code) updates.invite_code = randomCode();
    }
  }

  if (regenerate_invite) updates.invite_code = randomCode();

  if (Object.keys(updates).length === 0) return json({ error: "Nothing to update" }, 400);

  const { data: updated, error } = await db.from("groups")
    .update(updates).eq("id", group_id).select("invite_code").single();
  if (error) {
    console.error("[groups/update] error:", JSON.stringify(error));
    return json({ error: error.message }, 500);
  }

  return json({ success: true, invite_code: updated.invite_code });
};
