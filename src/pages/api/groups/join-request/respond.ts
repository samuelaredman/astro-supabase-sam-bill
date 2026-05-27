import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { request_id, group_id, requester_profile_id, action } = body; // action: 'accept' | 'reject'

  if (!["accept", "reject"].includes(action)) {
    return json({ error: "action must be 'accept' or 'reject'" }, 400);
  }
  // Accept either request_id OR (group_id + requester_profile_id)
  if (!request_id && !(group_id && requester_profile_id)) {
    return json({ error: "Provide either request_id, or both group_id and requester_profile_id" }, 400);
  }

  // Fetch the request — look up by id or by (group_id, profile_id)
  let reqQuery = db.from("group_join_requests").select("id, group_id, profile_id, status").eq("status", "pending");
  if (request_id) {
    reqQuery = reqQuery.eq("id", request_id);
  } else {
    reqQuery = reqQuery.eq("group_id", group_id).eq("profile_id", requester_profile_id);
  }
  const { data: req } = await reqQuery.maybeSingle();
  if (!req) return json({ error: "Pending request not found" }, 404);

  // Caller must be an admin or owner of that group
  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", req.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  // Delete the join request row — it's served its purpose
  const { error: deleteErr } = await db.from("group_join_requests")
    .delete()
    .eq("id", req.id);
  if (deleteErr) {
    console.error("[join-request/respond] delete error:", JSON.stringify(deleteErr));
    return json({ error: "Failed to process request." }, 500);
  }

  // If accepted, add the user to the group
  if (action === "accept") {
    const { error: memberErr } = await db.from("group_members").insert({
      group_id: req.group_id,
      profile_id: req.profile_id,
      role: "member",
    });
    if (memberErr && !memberErr.message?.includes("duplicate")) {
      console.error("[join-request/respond] member insert error:", JSON.stringify(memberErr));
      return json({ error: "Failed to add member." }, 500);
    }
  }

  // Notify the requester and clean up the join-request notifications sent to admins
  try {
    await db.from("notifications").insert({
      profile_id: req.profile_id,
      actor_profile_id: profile.id,
      type: action === "accept" ? "group_join_accepted" : "group_join_rejected",
      group_id: req.group_id,
    });
  } catch (e) {
    console.error("[join-request/respond] notification error (non-fatal):", e);
  }

  // Delete the group_join_request notifications that were sent to all admins for this requester.
  // Non-fatal — if this fails the only consequence is stale Accept/Reject buttons in the UI.
  try {
    await db.from("notifications")
      .delete()
      .eq("type", "group_join_request")
      .eq("group_id", req.group_id)
      .eq("actor_profile_id", req.profile_id);
  } catch (e) {
    console.error("[join-request/respond] notification cleanup error (non-fatal):", e);
  }

  return json({ success: true, action });
};
