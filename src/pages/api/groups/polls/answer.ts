import type { APIRoute } from "astro";
import { requireAuth, json, getGroupAuthority } from "../../../../utils/api";
import { readPollAnswer } from "../../../../utils/groupFeaturedGames";

/**
 * A written answer to a group question (a featured game's question on the Games
 * tab). One per member: { poll_id, body } saves or replaces the caller's, and an
 * empty body deletes it. { answer_id, action: "delete" } removes any answer, for
 * its author, the question's author, or whoever can manage the group's polls.
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

    let canDelete = answer.profile_id === profile.id || answer.group_polls.profile_id === profile.id;
    if (!canDelete) {
      const authority = await getGroupAuthority(db, answer.group_polls.group_id, profile.id);
      canDelete = ["owner", "admin"].includes(authority?.role ?? "");
      if (!canDelete && authority?.custom_role_id) {
        const { data: cr } = await db.from("group_roles")
          .select("can_edit_group").eq("id", authority.custom_role_id).maybeSingle();
        canDelete = !!cr?.can_edit_group;
      }
    }
    if (!canDelete) return json({ error: "Not authorized" }, 403);

    const { error } = await db.from("group_poll_answers").delete().eq("id", answer.id);
    if (error) {
      console.error("[groups/polls/answer] delete error:", JSON.stringify(error));
      return json({ error: "Failed to delete the answer" }, 500);
    }
    return json({ success: true });
  }

  const { poll_id } = body;
  if (!poll_id) return json({ error: "poll_id is required" }, 400);
  const answer = readPollAnswer(body.body);
  if ("error" in answer) return json({ error: answer.error }, 400);

  const { data: poll } = await db.from("group_polls")
    .select("id, group_id, closed").eq("id", poll_id).maybeSingle();
  if (!poll) return json({ error: "Question not found" }, 404);
  if (poll.closed) return json({ error: "This question is closed" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", poll.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to answer" }, 403);

  if (answer.body === null) {
    const { error } = await db.from("group_poll_answers")
      .delete().eq("poll_id", poll_id).eq("profile_id", profile.id);
    if (error) {
      console.error("[groups/polls/answer] clear error:", JSON.stringify(error));
      return json({ error: "Failed to delete your answer" }, 500);
    }
    return json({ success: true });
  }

  // One answer per member: update theirs if they have one, otherwise add it
  const { data: existing } = await db.from("group_poll_answers")
    .select("id").eq("poll_id", poll_id).eq("profile_id", profile.id).maybeSingle();
  const { error } = existing
    ? await db.from("group_poll_answers")
        .update({ body: answer.body, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await db.from("group_poll_answers")
        .insert({ poll_id, profile_id: profile.id, body: answer.body });
  if (error) {
    console.error("[groups/polls/answer] save error:", JSON.stringify(error));
    return json({ error: "Failed to save your answer" }, 500);
  }
  return json({ success: true });
};
