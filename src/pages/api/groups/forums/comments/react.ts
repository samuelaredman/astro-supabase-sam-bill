import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../../utils/api";

// Toggle an emote reaction on a group forum thread (Discussions) comment.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, reaction_type } = await context.request.json();
  if (!comment_id || !reaction_type)
    return json({ error: "comment_id and reaction_type are required." }, 400);

  const { data: existing } = await (db as any)
    .from("group_forum_thread_comment_reactions")
    .select("id")
    .eq("comment_id", comment_id)
    .eq("profile_id", profile.id)
    .eq("reaction_type", reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await (db as any).from("group_forum_thread_comment_reactions").delete()
      .eq("comment_id", comment_id)
      .eq("profile_id", profile.id)
      .eq("reaction_type", reaction_type);
    reacted = false;
  } else {
    await (db as any).from("group_forum_thread_comment_reactions")
      .insert({ comment_id, profile_id: profile.id, reaction_type });
    reacted = true;
  }

  const { count } = await (db as any)
    .from("group_forum_thread_comment_reactions")
    .select("*", { count: "exact", head: true })
    .eq("comment_id", comment_id)
    .eq("reaction_type", reaction_type);

  return json({ reacted, count: count ?? 0, reaction_type });
};
