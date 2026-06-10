import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, target_profile_id, role } = await context.request.json();
  if (!["admin", "member"].includes(role)) return json({ error: "role must be admin or member" }, 400);

  const { data: callerMembership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!callerMembership || callerMembership.role !== "owner") {
    return json({ error: "Only the owner can change roles" }, 403);
  }

  if (target_profile_id === profile.id) return json({ error: "Cannot change your own role" }, 400);

  const { error } = await db.from("group_members")
    .update({ role }).eq("group_id", group_id).eq("profile_id", target_profile_id);
  if (error) return json({ error: error.message }, 500);

  return json({ success: true });
};
