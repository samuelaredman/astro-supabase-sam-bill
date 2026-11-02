import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../utils/api";

// Edit an announcement: title + body. The author can always edit their own;
// group owners/admins (and custom roles with can_edit_group) can edit any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { announcement_id, title, body } = await context.request.json();
  if (!announcement_id || !body?.trim())
    return json({ error: "announcement_id and body are required" }, 400);
  if (title && String(title).length > 200)
    return json({ error: "Title too long (max 200)" }, 400);
  if (body.length > 2000000)
    return json({ error: "Announcement is too large" }, 400);

  const { data: announcement } = await db.from("group_announcements")
    .select("id, group_id, profile_id").eq("id", announcement_id).maybeSingle();
  if (!announcement) return json({ error: "Announcement not found" }, 404);

  const isAuthor = announcement.profile_id === profile.id;
  let canEdit = isAuthor;
  if (!canEdit) {
    const membership = await getGroupAuthority(db, announcement.group_id, profile.id);
    if (membership) {
      canEdit = ["owner", "admin"].includes(membership.role);
      if (!canEdit && membership.custom_role_id) {
        const { data: cr } = await db.from("group_roles")
          .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
        canEdit = !!cr?.can_edit_group;
      }
    }
  }
  if (!canEdit) return json({ error: "Not authorized" }, 403);

  const { error } = await db.from("group_announcements").update({
    title: title ? String(title).trim() : null,
    body: body.trim(),
    updated_at: new Date().toISOString(),
  }).eq("id", announcement_id);
  if (error) {
    console.error("[groups/announcements/update] error:", JSON.stringify(error));
    return json({ error: "Failed to save announcement" }, 500);
  }

  return json({ success: true });
};
