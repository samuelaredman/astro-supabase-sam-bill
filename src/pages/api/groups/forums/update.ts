import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../utils/api";

// Edit a forum thread: title + body. The author can always edit their own;
// group owners/admins (and custom roles with can_edit_group) can edit any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { thread_id, title, body } = await context.request.json();
  if (!thread_id || !body?.trim())
    return json({ error: "thread_id and body are required" }, 400);
  if (title && String(title).length > 200)
    return json({ error: "Title too long (max 200)" }, 400);
  if (body.length > 2000000)
    return json({ error: "Thread is too large" }, 400);

  const { data: thread } = await (db as any).from("group_forum_threads")
    .select("id, group_id, profile_id").eq("id", thread_id).maybeSingle();
  if (!thread) return json({ error: "Thread not found" }, 404);

  const isAuthor = thread.profile_id === profile.id;
  let canEdit = isAuthor;
  if (!canEdit) {
    const membership = await getGroupAuthority(db, thread.group_id, profile.id);
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

  const { error } = await (db as any).from("group_forum_threads").update({
    title: title ? String(title).trim() : null,
    body: body.trim(),
    updated_at: new Date().toISOString(),
  }).eq("id", thread_id);
  if (error) {
    console.error("[groups/forums/update] error:", JSON.stringify(error));
    return json({ error: "Failed to save thread" }, 500);
  }

  return json({ success: true });
};
