import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, invite_code } = body;

  // Resolve the group — by id or invite_code
  let groupQuery = db.from("groups").select("id, visibility, invite_code");
  if (invite_code) {
    groupQuery = groupQuery.eq("invite_code", invite_code.toUpperCase());
  } else if (group_id) {
    groupQuery = groupQuery.eq("id", group_id);
  } else {
    return json({ error: "group_id or invite_code required" }, 400);
  }

  const { data: group } = await groupQuery.single();
  if (!group) return json({ error: "Group not found" }, 404);

  // Private groups: only joinable via a valid admin-sent invite code
  if (group.visibility === "private") {
    if (!invite_code || group.invite_code !== invite_code.toUpperCase()) {
      return json({ error: "This group is private. Request to join or use an invite link.", code: "PRIVATE_GROUP" }, 403);
    }
  }

  const { data: existing } = await db.from("group_members")
    .select("id").eq("group_id", group.id).eq("profile_id", profile.id).maybeSingle();
  if (existing) return json({ error: "Already a member" }, 409);

  const { error } = await db.from("group_members").insert({
    group_id: group.id,
    profile_id: profile.id,
    role: "member",
  });
  if (error) {
    console.error("[groups/join] error:", JSON.stringify(error));
    return json({ error: error.message }, 500);
  }

  // Mark the direct invite as accepted if one exists
  if (invite_code) {
    await db.from("group_invites")
      .update({ status: "accepted" })
      .eq("group_id", group.id)
      .eq("invited_profile_id", profile.id);
  }

  return json({ id: group.id });
};
