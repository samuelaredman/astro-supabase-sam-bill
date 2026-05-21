import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, game_id, played_at, notes, attendee_ids } = await context.request.json();
  if (!group_id || !game_id || !played_at) return json({ error: "group_id, game_id, and played_at are required" }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  const { data: session, error } = await db.from("group_sessions").insert({
    group_id, game_id, played_at, notes: notes?.trim() || null, created_by: profile.id,
  }).select("id").single();
  if (error) return json({ error: error.message }, 500);

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

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
