import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../../utils/api";

// Up/downvote a group forum thread (Discussions) comment. Mirrors
// src/pages/api/comments/vote.ts: same vote toggles off, different vote switches.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, vote } = await context.request.json();
  if (!comment_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  const { data: existing } = await (db as any)
    .from("group_forum_thread_comment_votes")
    .select("vote")
    .eq("profile_id", profile.id)
    .eq("comment_id", comment_id)
    .maybeSingle();

  let newVote: number | null;
  if (existing) {
    if (existing.vote === vote) {
      const { error } = await (db as any)
        .from("group_forum_thread_comment_votes")
        .delete()
        .eq("profile_id", profile.id)
        .eq("comment_id", comment_id);
      if (error) return json({ error: "Failed to remove vote.", detail: error.message }, 500);
      newVote = null;
    } else {
      const { error } = await (db as any)
        .from("group_forum_thread_comment_votes")
        .update({ vote })
        .eq("profile_id", profile.id)
        .eq("comment_id", comment_id);
      if (error) return json({ error: "Failed to update vote.", detail: error.message }, 500);
      newVote = vote;
    }
  } else {
    const { error } = await (db as any)
      .from("group_forum_thread_comment_votes")
      .insert({ profile_id: profile.id, comment_id, vote });
    if (error) return json({ error: "Failed to save vote.", detail: error.message }, 500);
    newVote = vote;
  }

  const { data: voteRows } = await (db as any)
    .from("group_forum_thread_comment_votes")
    .select("vote")
    .eq("comment_id", comment_id);
  const rows = voteRows ?? [];
  const upCount = rows.filter((v: { vote: number }) => v.vote === 1).length;
  const downCount = rows.filter((v: { vote: number }) => v.vote === -1).length;

  return json({ vote: newVote, up: upCount, down: downCount });
};
