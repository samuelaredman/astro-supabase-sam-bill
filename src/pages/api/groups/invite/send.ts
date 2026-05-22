import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, invited_username } = await context.request.json();
  const db = getSupabaseAdmin() as any;

  // Caller must be owner or admin
  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", group_id).eq("profile_id", profile.id).single();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Not authorized" }, 403);
  }

  const { data: invitee } = await db.from("profiles")
    .select("id, username").ilike("username", invited_username.replace(/[%_]/g, "\\$&")).single();
  if (!invitee) return json({ error: "User not found" }, 404);

  // Can't invite someone already in the group
  const { data: alreadyMember } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", invitee.id).maybeSingle();
  if (alreadyMember) return json({ error: `${invitee.username} is already in the group` }, 409);

  // Upsert invite (resets if previously declined)
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: inviteError } = await db.from("group_invites").upsert({
    group_id,
    invited_by: profile.id,
    invited_profile_id: invitee.id,
    status: "pending",
    expires_at: expires,
  }, { onConflict: "group_id,invited_profile_id" });
  if (inviteError) return json({ error: inviteError.message }, 500);

  // Fire notification
  const { data: groupData } = await db.from("groups").select("name").eq("id", group_id).single();
  await db.from("notifications").insert({
    profile_id: invitee.id,
    type: "group_invite",
    actor_profile_id: profile.id,
    group_id,
  }).catch(() => {});

  return json({ success: true, username: invitee.username, group_name: groupData?.name });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
