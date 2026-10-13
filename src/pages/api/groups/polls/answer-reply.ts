import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { canModeratePoll, readPollAnswer } from "../../../../utils/groupFeaturedGames";

/**
 * Replies to an answer on a group question. { answer_id, body } adds one
 * (members only, while the question is open); { reply_id, action: "delete" }
 * removes one, for its author or whoever can moderate the question.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();

  if (body.action === "delete") {
    if (!body.reply_id) return json({ error: "reply_id is required" }, 400);
    const { data: reply } = await db.from("group_poll_answer_replies")
      .select("id, profile_id, group_poll_answers ( group_polls ( group_id, profile_id ) )")
      .eq("id", body.reply_id).maybeSingle();
    const poll = (reply?.group_poll_answers as any)?.group_polls;
    if (!reply || !poll) return json({ error: "Reply not found" }, 404);
    const canDelete = reply.profile_id === profile.id || await canModeratePoll(db, poll, profile.id);
    if (!canDelete) return json({ error: "Not authorized" }, 403);
    const { error } = await db.from("group_poll_answer_replies").delete().eq("id", reply.id);
    if (error) {
      console.error("[groups/polls/answer-reply] delete error:", JSON.stringify(error));
      return json({ error: "Failed to delete the reply" }, 500);
    }
    return json({ success: true });
  }

  const { answer_id } = body;
  if (!answer_id) return json({ error: "answer_id is required" }, 400);
  const reply = readPollAnswer(body.body);
  if ("error" in reply) return json({ error: reply.error.replace("answer", "reply") }, 400);
  if (!reply.body) return json({ error: "Write a reply first" }, 400);

  const { data: answer } = await db.from("group_poll_answers")
    .select("id, group_polls ( group_id, closed )").eq("id", answer_id).maybeSingle();
  if (!answer?.group_polls) return json({ error: "Answer not found" }, 404);
  if (answer.group_polls.closed) return json({ error: "This question is closed" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", answer.group_polls.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to reply" }, 403);

  const { error } = await db.from("group_poll_answer_replies")
    .insert({ answer_id, profile_id: profile.id, body: reply.body });
  if (error) {
    console.error("[groups/polls/answer-reply] insert error:", JSON.stringify(error));
    return json({ error: "Failed to post your reply" }, 500);
  }
  return json({ success: true });
};
