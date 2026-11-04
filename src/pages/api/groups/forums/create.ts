import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../utils/api";

// Start a forum thread. By default any current member may post; owner/admins
// (and roles with can_edit_group) may post regardless of the toggle.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, title, body } = await context.request.json();
  if (!group_id || !body?.trim())
    return json({ error: "group_id and body are required" }, 400);
  if (title && String(title).length > 200)
    return json({ error: "Title too long (max 200)" }, 400);
  // Bodies are Tiptap HTML (base64 images blow past small limits).
  if (body.length > 2000000)
    return json({ error: "Thread is too large" }, 400);

  const membership = await getGroupAuthority(db, group_id, profile.id);
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  // Owner/admin can always post. Roles with can_edit_group too.
  let canPost = ["owner", "admin"].includes(membership.role);
  if (!canPost && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canPost = !!cr?.can_edit_group;
  }
  // Otherwise check the group's forums_everyone switch.
  if (!canPost) {
    const { data: g } = await (db as any).from("groups")
      .select("forums_everyone").eq("id", group_id).maybeSingle();
    canPost = !!g?.forums_everyone;
  }
  if (!canPost) return json({ error: "Only admins can start threads in this group" }, 403);

  const { data: thread, error } = await (db as any).from("group_forum_threads").insert({
    group_id, profile_id: profile.id,
    title: title ? String(title).trim() : null,
    body: body.trim(),
  }).select("id").single();
  if (error) {
    console.error("[groups/forums/create] error:", JSON.stringify(error));
    return json({ error: "Failed to post thread" }, 500);
  }

  return json({ id: thread.id });
};
