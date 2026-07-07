import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, new_owner_profile_id } = await context.request.json();
  if (!group_id || !new_owner_profile_id)
    return json({ error: "group_id and new_owner_profile_id are required." }, 400);

  if (new_owner_profile_id === profile.id)
    return json({ error: "You are already the owner." }, 400);

  const { data: callerMembership } = await db.from("group_members")
    .select("id, role").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!callerMembership || callerMembership.role !== "owner")
    return json({ error: "Only the group owner can transfer ownership." }, 403);

  const { data: targetMembership } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", new_owner_profile_id).maybeSingle();
  if (!targetMembership) return json({ error: "Target is not a member of this group." }, 404);

  const { error: promoteError } = await db.from("group_members")
    .update({ role: "owner", custom_role_id: null }).eq("id", targetMembership.id);
  if (promoteError) {
    console.error("[groups/transfer-ownership] promote error:", JSON.stringify(promoteError));
    return json({ error: "Failed to transfer ownership." }, 500);
  }

  const { error: demoteError } = await db.from("group_members")
    .update({ role: "admin" }).eq("id", callerMembership.id);
  if (demoteError) {
    console.error("[groups/transfer-ownership] demote error:", JSON.stringify(demoteError));
    return json({ error: "Ownership transferred, but failed to update your own role. Refresh and check group members." }, 500);
  }

  return json({ success: true });
};
