import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, action } = await context.request.json();
  if (!["accept", "decline"].includes(action)) return json({ error: "action must be accept or decline" }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: invite } = await db.from("group_invites")
    .select("id, expires_at").eq("group_id", group_id).eq("invited_profile_id", profile.id)
    .eq("status", "pending").single();
  if (!invite) return json({ error: "No pending invite found" }, 404);

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    await db.from("group_invites").update({ status: "declined" }).eq("id", invite.id);
    return json({ error: "Invite has expired" }, 410);
  }

  await db.from("group_invites").update({ status: action === "accept" ? "accepted" : "declined" }).eq("id", invite.id);

  if (action === "accept") {
    const { data: existing } = await db.from("group_members")
      .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
    if (!existing) {
      await db.from("group_members").insert({ group_id, profile_id: profile.id, role: "member" });
    }
    return json({ success: true, joined: true });
  }

  return json({ success: true, joined: false });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
