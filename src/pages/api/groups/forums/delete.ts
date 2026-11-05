import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { thread_id } = await context.request.json();
  if (!thread_id) return json({ error: "thread_id is required" }, 400);

  const { data: thread } = await (db as any).from("group_forum_threads")
    .select("id, group_id, profile_id").eq("id", thread_id).maybeSingle();
  if (!thread) return json({ error: "Thread not found" }, 404);

  const membership = await getGroupAuthority(db, thread.group_id, profile.id);
  if (!membership) return json({ error: "Not a member" }, 403);

  let canManage = ["owner", "admin"].includes(membership.role);
  if (!canManage && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canManage = !!cr?.can_edit_group;
  }

  const canDelete = thread.profile_id === profile.id || canManage;
  if (!canDelete) return json({ error: "Not authorized" }, 403);

  await (db as any).from("group_forum_threads").delete().eq("id", thread_id);
  return json({ success: true });
};
