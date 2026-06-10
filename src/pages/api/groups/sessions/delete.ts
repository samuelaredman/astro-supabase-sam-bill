import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { session_id } = await context.request.json();

  const { data: session } = await db.from("group_sessions")
    .select("id, group_id, created_by").eq("id", session_id).single();
  if (!session) return json({ error: "Session not found" }, 404);

  const { data: membership } = await db.from("group_members")
    .select("role").eq("group_id", session.group_id).eq("profile_id", profile.id).single();
  if (!membership) return json({ error: "Not a member" }, 403);

  const canDelete = session.created_by === profile.id || ["owner", "admin"].includes(membership.role);
  if (!canDelete) return json({ error: "Not authorized" }, 403);

  await db.from("group_sessions").delete().eq("id", session_id);
  return json({ success: true });
};
