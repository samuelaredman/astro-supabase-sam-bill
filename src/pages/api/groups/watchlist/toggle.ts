import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const { group_id, game_id } = await context.request.json();
  const db = getSupabaseAdmin() as any;

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  const { data: existing } = await db.from("group_watchlist")
    .select("id").eq("group_id", group_id).eq("game_id", game_id).maybeSingle();

  if (existing) {
    await db.from("group_watchlist").delete().eq("id", existing.id);
    return json({ added: false });
  }

  await db.from("group_watchlist").insert({ group_id, game_id, added_by: profile.id });
  return json({ added: true });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
