import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, body, pinned } = await context.request.json();
  if (!group_id || !body?.trim())
    return json({ error: "group_id and body are required" }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Announcement is too long (max 2000 characters)" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  let canPost = ["owner", "admin"].includes(membership.role);
  if (!canPost && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canPost = !!cr?.can_edit_group;
  }
  if (!canPost) return json({ error: "Your role does not have permission to post announcements" }, 403);

  const { data: announcement, error } = await db.from("group_announcements").insert({
    group_id, profile_id: profile.id, body: body.trim(), pinned: !!pinned,
  }).select("id").single();
  if (error) {
    console.error("[groups/announcements/create] error:", JSON.stringify(error));
    return json({ error: "Failed to post announcement" }, 500);
  }

  return json({ id: announcement.id });
};
