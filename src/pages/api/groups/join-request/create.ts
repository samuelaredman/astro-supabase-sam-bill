import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, message } = body;
  if (!group_id) return json({ error: "group_id is required" }, 400);

  // Verify the group actually requires a join request (private, or public with approval required)
  const { data: group } = await db.from("groups")
    .select("id, name, visibility, requires_approval").eq("id", group_id).single();
  if (!group) return json({ error: "Group not found" }, 404);
  if (group.visibility !== "private" && !group.requires_approval) {
    return json({ error: "This group doesn't require a join request — join directly." }, 400);
  }

  // Not already a member
  const { data: existing } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (existing) return json({ error: "Already a member" }, 409);

  // Upsert so re-requesting after a rejection resets to pending
  const { error } = await db.from("group_join_requests").upsert({
    group_id,
    profile_id: profile.id,
    message: message?.trim() || null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
  }, { onConflict: "group_id,profile_id" });

  if (error) {
    console.error("[join-request/create] error:", JSON.stringify(error));
    return json({ error: "Failed to submit request." }, 500);
  }

  // Notify group admins/owners
  try {
    const { data: admins } = await db.from("group_members")
      .select("profile_id").eq("group_id", group_id).in("role", ["owner", "admin"]);
    if (admins?.length) {
      await db.from("notifications").insert(
        admins.map((a: any) => ({
          profile_id: a.profile_id,
          actor_profile_id: profile.id,
          type: "group_join_request",
          group_id,
        }))
      );
    }
  } catch (e) {
    console.error("[join-request/create] notification error (non-fatal):", e);
  }

  return json({ success: true });
};
