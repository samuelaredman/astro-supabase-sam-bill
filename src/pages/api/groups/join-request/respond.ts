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
  const { request_id, action } = body; // action: 'accept' | 'reject'
  if (!request_id || !["accept", "reject"].includes(action)) {
    return json({ error: "request_id and action ('accept'|'reject') are required" }, 400);
  }

  // Fetch the request
  const { data: req } = await db.from("group_join_requests")
    .select("id, group_id, profile_id, status").eq("id", request_id).single();
  if (!req) return json({ error: "Request not found" }, 404);
  if (req.status !== "pending") return json({ error: "Request already resolved" }, 409);

  // Caller must be an admin or owner of that group
  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", req.group_id).eq("profile_id", profile.id).single();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  const newStatus = action === "accept" ? "accepted" : "rejected";

  // Update the request
  const { error: updateErr } = await db.from("group_join_requests")
    .update({ status: newStatus, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", request_id);
  if (updateErr) {
    console.error("[join-request/respond] update error:", JSON.stringify(updateErr));
    return json({ error: "Failed to update request." }, 500);
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

  // Notify the requester
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

  return json({ success: true, status: newStatus });
};
