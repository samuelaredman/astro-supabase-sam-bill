import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { poll_id, closed } = await context.request.json();
  if (!poll_id || typeof closed !== "boolean")
    return json({ error: "poll_id and closed are required" }, 400);

  const { data: poll } = await db.from("group_polls")
    .select("id, group_id, profile_id").eq("id", poll_id).maybeSingle();
  if (!poll) return json({ error: "Poll not found" }, 404);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", poll.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member" }, 403);

  let canManage = ["owner", "admin"].includes(membership.role);
  if (!canManage && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canManage = !!cr?.can_edit_group;
  }
  const canClose = poll.profile_id === profile.id || canManage;
  if (!canClose) return json({ error: "Not authorized" }, 403);

  const { error } = await db.from("group_polls").update({ closed }).eq("id", poll_id);
  if (error) {
    console.error("[groups/polls/close] error:", JSON.stringify(error));
    return json({ error: "Failed to update poll" }, 500);
  }

  return json({ success: true });
};
