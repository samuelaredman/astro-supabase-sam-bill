import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, game_id, played_at, notes, attendee_ids } = await context.request.json();
  if (!group_id || !game_id || !played_at)
    return json({ error: "group_id, game_id, and played_at are required" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  // Members with a custom role must have can_manage_sessions=true (and not be view-only).
  // Plain members (no custom role) retain the original unrestricted access.
  if (membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_manage_sessions, is_view_only").eq("id", membership.custom_role_id).maybeSingle();
    if (!cr?.can_manage_sessions || cr?.is_view_only)
      return json({ error: "Your role does not have permission to manage sessions" }, 403);
  }

  const { data: session, error } = await db.from("group_sessions").insert({
    group_id, game_id, played_at, notes: notes?.trim() || null, created_by: profile.id,
  }).select("id").single();
  if (error) {
    console.error("[groups/sessions/create] error:", JSON.stringify(error));
    return json({ error: "Failed to create session" }, 500);
  }

  // Add attendees — always include the creator; filter to group members only
  const ids: string[] = Array.isArray(attendee_ids) ? attendee_ids : [];
  if (!ids.includes(profile.id)) ids.push(profile.id);

  const { data: members } = await db.from("group_members")
    .select("profile_id").eq("group_id", group_id).in("profile_id", ids);
  const validIds = (members ?? []).map((m: any) => m.profile_id);

  if (validIds.length > 0) {
    await db.from("group_session_members").insert(
      validIds.map((pid: string) => ({ session_id: session.id, profile_id: pid }))
    );
  }

  return json({ id: session.id });
};
