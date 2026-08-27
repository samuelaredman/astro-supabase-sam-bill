import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { group_id, question, options } = await context.request.json();
  if (!group_id || !question?.trim())
    return json({ error: "group_id and question are required" }, 400);
  if (question.trim().length > 300)
    return json({ error: "Question is too long (max 300 characters)" }, 400);

  const cleanOptions: string[] = Array.isArray(options)
    ? options.map((o: string) => o?.trim()).filter(Boolean)
    : [];
  if (cleanOptions.length < 2 || cleanOptions.length > 6)
    return json({ error: "A poll needs between 2 and 6 options" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("role, custom_role_id").eq("group_id", group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  let canPost = ["owner", "admin"].includes(membership.role);
  if (!canPost && membership.custom_role_id) {
    const { data: cr } = await db.from("group_roles")
      .select("can_edit_group").eq("id", membership.custom_role_id).maybeSingle();
    canPost = !!cr?.can_edit_group;
  }
  if (!canPost) return json({ error: "Your role does not have permission to create polls" }, 403);

  const { data: poll, error } = await db.from("group_polls").insert({
    group_id, profile_id: profile.id, question: question.trim(),
  }).select("id").single();
  if (error) {
    console.error("[groups/polls/create] error:", JSON.stringify(error));
    return json({ error: "Failed to create poll" }, 500);
  }

  const { error: optError } = await db.from("group_poll_options").insert(
    cleanOptions.map((label, i) => ({ poll_id: poll.id, label, position: i }))
  );
  if (optError) {
    console.error("[groups/polls/create] option insert error:", JSON.stringify(optError));
    await db.from("group_polls").delete().eq("id", poll.id);
    return json({ error: "Failed to create poll" }, 500);
  }

  return json({ id: poll.id });
};
