import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

function randomCode(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { name, description, visibility } = body;

  if (!name?.trim()) return json({ error: "Name is required" }, 400);
  if (!["public", "private"].includes(visibility)) return json({ error: "Invalid visibility" }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: group, error } = await db.from("groups").insert({
    name: name.trim(),
    description: description?.trim() || null,
    visibility,
    invite_code: visibility === "private" ? randomCode() : null,
    created_by: profile.id,
  }).select("id, invite_code").single();

  if (error) {
    if (error.message?.includes("cannot create more than 10")) {
      return json({ error: "You can't create more than 10 groups." }, 400);
    }
    return json({ error: error.message }, 500);
  }

  await db.from("group_members").insert({
    group_id: group.id,
    profile_id: profile.id,
    role: "owner",
  });

  return json({ id: group.id, invite_code: group.invite_code });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
