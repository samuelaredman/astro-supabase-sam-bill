import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  // Always use admin client for DB operations
  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { group_id, invited_username } = body;

  if (!group_id) return json({ error: "group_id required" }, 400);
  if (!invited_username?.trim()) return json({ error: "Username required" }, 400);

  // Caller must be owner or admin
  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  const cleanUsername = invited_username.trim().replace(/^@/, "").replace(/[%_]/g, "\\$&");
  const { data: invitee } = await db.from("profiles")
    .select("id, username").ilike("username", cleanUsername).maybeSingle();
  if (!invitee) return json({ error: "User not found" }, 404);

  // Can't invite yourself
  if (invitee.id === profile.id) return json({ error: "You can't invite yourself" }, 400);

  // Can't invite someone already in the group
  const { data: alreadyMember } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", invitee.id).maybeSingle();
  if (alreadyMember) return json({ error: `@${invitee.username} is already in the group` }, 409);

  // Upsert invite — resets status to pending if previously declined
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: inviteError } = await db.from("group_invites").upsert({
    group_id,
    invited_by: profile.id,
    invited_profile_id: invitee.id,
    status: "pending",
    expires_at: expires,
  }, { onConflict: "group_id,invited_profile_id" });
  if (inviteError) {
    console.error("[groups/invite/send] upsert error:", JSON.stringify(inviteError));
    return json({ error: "Failed to send invite" }, 500);
  }

  // Fire notification — delete any existing one first to avoid dupes on re-invite
  try {
    await db.from("notifications")
      .delete()
      .eq("profile_id", invitee.id)
      .eq("type", "group_invite")
      .eq("group_id", group_id);
    await db.from("notifications").insert({
      profile_id: invitee.id,
      type: "group_invite",
      actor_profile_id: profile.id,
      group_id,
    });
  } catch (e) {
    console.error("[groups/invite/send] notification error (non-fatal):", e);
  }

  return json({ success: true, username: invitee.username });
};
