import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

/**
 * Toggle the caller's upvote on an answer to a group question. Members only,
 * and not on their own answer. Returns the answer's new count.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { answer_id } = await context.request.json();
  if (!answer_id) return json({ error: "answer_id is required" }, 400);

  const { data: answer } = await db.from("group_poll_answers")
    .select("id, profile_id, group_polls ( group_id )").eq("id", answer_id).maybeSingle();
  if (!answer?.group_polls) return json({ error: "Answer not found" }, 404);
  if (answer.profile_id === profile.id) return json({ error: "You can't upvote your own answer" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", answer.group_polls.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to upvote" }, 403);

  const { data: existing } = await db.from("group_poll_answer_votes")
    .select("answer_id").eq("answer_id", answer_id).eq("profile_id", profile.id).maybeSingle();
  const { error } = existing
    ? await db.from("group_poll_answer_votes").delete().eq("answer_id", answer_id).eq("profile_id", profile.id)
    : await db.from("group_poll_answer_votes").insert({ answer_id, profile_id: profile.id });
  if (error && error.code !== "23505") {
    console.error("[groups/polls/answer-vote] toggle error:", JSON.stringify(error));
    return json({ error: "Failed to save your upvote" }, 500);
  }

  const { count } = await db.from("group_poll_answer_votes")
    .select("answer_id", { count: "exact", head: true }).eq("answer_id", answer_id);
  return json({ upvoted: !existing, count: count ?? 0 });
};
