import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, action } = body;

  if (!group_id) return json({ error: "group_id required" }, 400);
  if (!["accept", "decline"].includes(action)) return json({ error: "action must be accept or decline" }, 400);

  const { data: invite } = await db.from("group_invites")
    .select("id, expires_at")
    .eq("group_id", group_id)
    .eq("invited_profile_id", profile.id)
    .eq("status", "pending")
    .maybeSingle();

  if (!invite) return json({ error: "No pending invite found" }, 404);

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    await db.from("group_invites").update({ status: "declined" }).eq("id", invite.id);
    // Clean up the stale notification
    try {
      await db.from("notifications")
        .delete()
        .eq("profile_id", profile.id)
        .eq("type", "group_invite")
        .eq("group_id", group_id);
    } catch {}
    return json({ error: "Invite has expired" }, 410);
  }

  const { error: updateErr } = await db.from("group_invites")
    .update({ status: action === "accept" ? "accepted" : "declined" })
    .eq("id", invite.id);
  if (updateErr) {
    console.error("[groups/invite/respond] update error:", JSON.stringify(updateErr));
    return json({ error: "Failed to process invite" }, 500);
  }

  if (action === "accept") {
    const { data: existing } = await db.from("group_members")
      .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
    if (!existing) {
      const { error: memberErr } = await db.from("group_members")
        .insert({ group_id, profile_id: profile.id, role: "member" });
      if (memberErr && !memberErr.message?.includes("duplicate")) {
        console.error("[groups/invite/respond] member insert error:", JSON.stringify(memberErr));
        return json({ error: "Failed to add you to the group" }, 500);
      }
    }
  }

  // Delete the group_invite notification — request is resolved
  try {
    await db.from("notifications")
      .delete()
      .eq("profile_id", profile.id)
      .eq("type", "group_invite")
      .eq("group_id", group_id);
  } catch (e) {
    console.error("[groups/invite/respond] notification cleanup error (non-fatal):", e);
  }

  return json({ success: true, joined: action === "accept" });
};
