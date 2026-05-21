import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { session_id } = await context.request.json();
  const db = getSupabaseAdmin() as any;

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

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
