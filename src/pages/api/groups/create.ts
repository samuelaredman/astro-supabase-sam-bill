import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

function randomCode(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const db = getSupabaseAdmin();

  const { data: profile } = await db
    .from("profiles").select("id, is_group_admin").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found" }, 404);

  const body = await context.request.json();
  const { name, description, visibility, join_prompt } = body;

  if (!name?.trim()) return json({ error: "Name is required" }, 400);
  if (!["public", "private", "community"].includes(visibility)) {
    return json({ error: "Invalid visibility" }, 400);
  }
  if (visibility === "community" && !profile.is_group_admin) {
    return json({ error: "Only admins can create Community groups" }, 403);
  }

  const { data: group, error } = await db.from("groups").insert({
    name: name.trim(),
    description: description?.trim() || null,
    visibility,
    invite_code: visibility === "private" ? randomCode() : null,
    join_prompt: visibility === "private" ? (join_prompt?.trim() || null) : null,
    created_by: profile.id,
  }).select("id, invite_code").single();

  if (error) {
    if (error.message?.includes("cannot create more than 10")) {
      return json({ error: "You can't create more than 10 groups." }, 400);
    }
    console.error("[groups/create] error:", JSON.stringify(error));
    return json({ error: error.message }, 500);
  }

  await db.from("group_members").insert({
    group_id: group.id,
    profile_id: profile.id,
    role: "owner",
  });

  return json({ id: group.id, invite_code: group.invite_code });
};
