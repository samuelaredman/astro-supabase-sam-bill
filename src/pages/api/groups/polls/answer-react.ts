import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

// Toggle an emote reaction on a poll answer OR one of its replies. Clients
// pass either answer_id OR reply_id (never both). Mirrors /api/comments/react
// for review comments so CommentThread's react button works the same way on
// polls as on reviews.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { answer_id, reply_id, reaction_type } = await context.request.json();
  if (!reaction_type || (!answer_id && !reply_id) || (answer_id && reply_id)) {
    return json({ error: "Provide exactly one of answer_id / reply_id, plus reaction_type." }, 400);
  }

  const targetCol = answer_id ? "answer_id" : "reply_id";
  const targetId = answer_id ?? reply_id;

  const { data: existing } = await (db as any)
    .from("group_poll_answer_reactions")
    .select("id")
    .eq(targetCol, targetId)
    .eq("profile_id", profile.id)
    .eq("reaction_type", reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    const { error } = await (db as any).from("group_poll_answer_reactions").delete()
      .eq(targetCol, targetId)
      .eq("profile_id", profile.id)
      .eq("reaction_type", reaction_type);
    if (error) {
      console.error("[polls/answer-react] delete error:", JSON.stringify(error));
      return json({ error: "Couldn't remove reaction." }, 500);
    }
    reacted = false;
  } else {
    const row: Record<string, unknown> = { profile_id: profile.id, reaction_type };
    row[targetCol] = targetId;
    const { error } = await (db as any).from("group_poll_answer_reactions").insert(row);
    if (error) {
      console.error("[polls/answer-react] insert error:", JSON.stringify(error));
      return json({ error: "Couldn't add reaction." }, 500);
    }
    reacted = true;
  }

  const { count } = await (db as any)
    .from("group_poll_answer_reactions")
    .select("*", { count: "exact", head: true })
    .eq(targetCol, targetId)
    .eq("reaction_type", reaction_type);

  if (reacted) {
    try {
      const row = answer_id
        ? (await (db as any).from("group_poll_answers").select("profile_id, poll_id").eq("id", answer_id).single()).data
        : (await (db as any).from("group_poll_answer_replies").select("profile_id, answer_id").eq("id", reply_id).single()).data;
      if (row && row.profile_id !== profile.id) {
        await (db as any).from("notifications").insert({
          profile_id: row.profile_id,
          actor_profile_id: profile.id,
          type: "poll_answer_reaction",
          reaction_type,
        });
      }
    } catch (e) {
      console.error("[polls/answer-react] notification error (non-fatal):", e);
    }
  }

  return json({ reacted, count: count ?? 0, reaction_type });
};
