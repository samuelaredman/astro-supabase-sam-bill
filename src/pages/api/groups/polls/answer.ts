import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { canModeratePoll, readPollAnswer } from "../../../../utils/groupFeaturedGames";

/**
 * Comments on a group poll. Mirrors review_comments semantics:
 *   { poll_id, body }                               → insert a new comment
 *   { action: "update", answer_id, body }           → edit an existing one
 *   { action: "delete", answer_id }                 → remove it (author or mod)
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();

  if (body.action === "delete") {
    if (!body.answer_id) return json({ error: "answer_id is required" }, 400);
    const { data: answer } = await db.from("group_poll_answers")
      .select("id, profile_id, group_polls ( group_id, profile_id )")
      .eq("id", body.answer_id).maybeSingle();
    if (!answer?.group_polls) return json({ error: "Answer not found" }, 404);

    const canDelete = answer.profile_id === profile.id
      || await canModeratePoll(db, answer.group_polls, profile.id);
    if (!canDelete) return json({ error: "Not authorized" }, 403);

    const { error } = await db.from("group_poll_answers").delete().eq("id", answer.id);
    if (error) {
      console.error("[groups/polls/answer] delete error:", JSON.stringify(error));
      return json({ error: "Failed to delete the answer" }, 500);
    }
    return json({ success: true });
  }

  if (body.action === "update") {
    if (!body.answer_id) return json({ error: "answer_id is required" }, 400);
    const parsed = readPollAnswer(body.body);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    if (parsed.body === null) return json({ error: "Comment can't be empty" }, 400);

    const { data: existing } = await db.from("group_poll_answers")
      .select("id, profile_id").eq("id", body.answer_id).maybeSingle();
    if (!existing) return json({ error: "Comment not found" }, 404);
    if (existing.profile_id !== profile.id) return json({ error: "Not authorized" }, 403);

    const { error } = await db.from("group_poll_answers")
      .update({ body: parsed.body, updated_at: new Date().toISOString() })
      .eq("id", body.answer_id);
    if (error) {
      console.error("[groups/polls/answer] update error:", JSON.stringify(error));
      return json({ error: "Failed to update your comment" }, 500);
    }
    return json({ success: true });
  }

  // Create path — unlimited comments per user per poll (schema unique
  // constraint dropped in 20261029000001).
  const { poll_id } = body;
  if (!poll_id) return json({ error: "poll_id is required" }, 400);
  const parsed = readPollAnswer(body.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  if (parsed.body === null) return json({ error: "Comment can't be empty" }, 400);

  const { data: poll } = await db.from("group_polls")
    .select("id, group_id, closed").eq("id", poll_id).maybeSingle();
  if (!poll) return json({ error: "Poll not found" }, 404);
  if (poll.closed) return json({ error: "This poll is closed" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", poll.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to comment" }, 403);

  const { error } = await db.from("group_poll_answers")
    .insert({ poll_id, profile_id: profile.id, body: parsed.body });
  if (error) {
    console.error("[groups/polls/answer] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post your comment" }, 500);
  }
  return json({ success: true });
};
