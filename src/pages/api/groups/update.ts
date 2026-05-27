import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

function randomCode(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { group_id, name, description, visibility, regenerate_invite } = body;

  const db = getSupabaseAdmin() as any;

  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (visibility !== undefined) {
    if (!["public", "private", "community"].includes(visibility)) {
      return json({ error: "Invalid visibility" }, 400);
    }
    // Only admins can set or change to community visibility
    if (visibility === "community") {
      const { data: prof } = await db.from("profiles").select("is_group_admin").eq("id", profile.id).single();
      if (!prof?.is_group_admin) return json({ error: "Only admins can set Community visibility" }, 403);
    }
    updates.visibility = visibility;
    if (visibility === "private") {
      const { data: g } = await db.from("groups").select("invite_code").eq("id", group_id).single();
      if (!g?.invite_code) updates.invite_code = randomCode();
    }
  }
  if (regenerate_invite) {
    updates.invite_code = randomCode();
  }

  const { data: updated, error } = await db.from("groups")
    .update(updates).eq("id", group_id).select("invite_code").single();
  if (error) return json({ error: error.message }, 500);

  return json({ success: true, invite_code: updated.invite_code });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
