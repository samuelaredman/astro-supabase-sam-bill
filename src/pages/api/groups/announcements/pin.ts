import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { announcement_id, pinned } = await context.request.json();
  if (!announcement_id || typeof pinned !== "boolean")
    return json({ error: "announcement_id and pinned are required" }, 400);

  const { data: announcement } = await db.from("group_announcements")
    .select("id, group_id").eq("id", announcement_id).maybeSingle();
  if (!announcement) return json({ error: "Announcement not found" }, 404);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", announcement.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member" }, 403);

  let canManage = ["owner", "admin"].includes(membership.role);
  if (!canManage && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canManage = !!cr?.can_edit_group;
  }
  if (!canManage) return json({ error: "Not authorized" }, 403);

  const { error } = await db.from("group_announcements").update({ pinned }).eq("id", announcement_id);
  if (error) {
    console.error("[groups/announcements/pin] error:", JSON.stringify(error));
    return json({ error: "Failed to update announcement" }, 500);
  }

  return json({ success: true });
};
