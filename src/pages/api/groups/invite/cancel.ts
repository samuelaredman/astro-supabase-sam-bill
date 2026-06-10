import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, invited_profile_id } = await context.request.json();
  if (!group_id || !invited_profile_id)
    return json({ error: "group_id and invited_profile_id required" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role))
    return json({ error: "Not authorized" }, 403);

  const { error } = await db.from("group_invites")
    .delete()
    .eq("group_id", group_id)
    .eq("invited_profile_id", invited_profile_id)
    .eq("status", "pending");
  if (error) {
    console.error("[groups/invite/cancel] error:", JSON.stringify(error));
    return json({ error: "Failed to cancel invite" }, 500);
  }

  // Remove the notification from the invitee's feed
  try {
    await db.from("notifications")
      .delete()
      .eq("profile_id", invited_profile_id)
      .eq("type", "group_invite")
      .eq("group_id", group_id);
  } catch (e) {
    console.error("[groups/invite/cancel] notification cleanup (non-fatal):", e);
  }

  return json({ success: true });
};
