import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../../utils/api";

// Delete an announcement comment. Author may delete their own; the group's
// owners/admins (and roles with can_edit_group) may delete any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const { data: comment } = await (db as any)
    .from("group_announcement_comments")
    .select("id, profile_id, announcement_id, group_announcements!inner(group_id)")
    .eq("id", comment_id)
    .maybeSingle();
  if (!comment) return json({ error: "Comment not found." }, 404);

  const isAuthor = comment.profile_id === profile.id;
  let canModerate = false;
  if (!isAuthor) {
    const groupId = comment.group_announcements?.group_id;
    if (groupId) {
      const membership = await getGroupAuthority(db, groupId, profile.id);
      if (membership) {
        canModerate = ["owner", "admin"].includes(membership.role);
        if (!canModerate && membership.custom_role_id) {
          const { data: cr } = await db.from("group_roles")
            .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
          canModerate = !!cr?.can_edit_group;
        }
      }
    }
  }
  if (!isAuthor && !canModerate) return json({ error: "Not authorized." }, 403);

  const { error } = await (db as any)
    .from("group_announcement_comments").delete().eq("id", comment_id);
  if (error) {
    console.error("[groups/announcements/comments/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete comment." }, 500);
  }

  return json({ success: true });
};
